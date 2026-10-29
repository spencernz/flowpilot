from datetime import timedelta
from time import perf_counter

from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError

from app.models.entities import (
    AIAnalysis,
    AuditEvent,
    CustomerRequest,
    RequestStatus,
    SupportTicket,
    now,
)
from app.repositories.requests import latest_analysis, ticket_for
from app.schemas.workflow import AnalysisOutput


def audit(db, request_id, event_type, **details):
    db.add(AuditEvent(request_id=request_id, event_type=event_type, details=details))


def require_request(db, request_id):
    request = db.get(CustomerRequest, request_id)
    if request is None:
        raise HTTPException(404, "Request not found")
    return request


def analyse_request(db, request_id, service):
    require_request(db, request_id)
    # Compare-and-set persists the processing lease before the slow provider call.
    # An expired lease can be retried after a process crash.
    cutoff = now() - timedelta(minutes=5)
    acquired = db.execute(
        update(CustomerRequest)
        .where(
            CustomerRequest.id == request_id,
            (
                CustomerRequest.status.in_(
                    [
                        RequestStatus.new,
                        RequestStatus.failed,
                        RequestStatus.needs_review,
                    ]
                )
            )
            | (
                (CustomerRequest.status == RequestStatus.processing)
                & (CustomerRequest.updated_at < cutoff)
            ),
        )
        .values(status=RequestStatus.processing, updated_at=now())
    ).rowcount
    if not acquired:
        db.rollback()
        raise HTTPException(409, "Request is already processing or completed")
    audit(db, request_id, "ai_analysis_started", provider=service.model_name)
    db.commit()
    request = require_request(db, request_id)
    started = perf_counter()
    try:
        output = AnalysisOutput.model_validate(service.analyse(request))
        analysis = AIAnalysis(
            request_id=request_id,
            **output.model_dump(),
            confidence=None,
            model_name=service.model_name,
            processing_duration_ms=max(1, round((perf_counter() - started) * 1000)),
        )
        db.add(analysis)
        request.status = RequestStatus.needs_review
        request.updated_at = now()
        audit(db, request_id, "ai_analysis_completed", model=service.model_name)
        db.commit()
        return analysis
    except Exception:  # noqa: BLE001 - persist a safe, retryable state for any provider failure
        db.rollback()
        request = require_request(db, request_id)
        request.status = RequestStatus.failed
        request.updated_at = now()
        audit(db, request_id, "ai_analysis_failed", reason="provider_error")
        db.commit()
        raise HTTPException(
            502, "Analysis failed. Check provider configuration or try again."
        ) from None


def approve_request(db, request_id, payload):
    if not payload.approved:
        raise HTTPException(422, "Explicit human approval is required")
    request = require_request(db, request_id)
    existing = ticket_for(db, request_id)
    if existing:
        return existing
    # Serialize edits, reanalysis and approval on the same request row.
    acquired = db.execute(
        update(CustomerRequest)
        .where(
            CustomerRequest.id == request_id,
            CustomerRequest.status == RequestStatus.needs_review,
        )
        .values(status=RequestStatus.completed, updated_at=now())
    ).rowcount
    if not acquired:
        db.rollback()
        existing = ticket_for(db, request_id)
        if existing:
            return existing
        raise HTTPException(409, "A completed analysis is required before approval")
    analysis = latest_analysis(db, request_id)
    if analysis is None or analysis.id != payload.analysis_id:
        db.rollback()
        raise HTTPException(409, "Review the latest analysis before approving")
    ticket = SupportTicket(
        request_id=request_id,
        analysis_id=analysis.id,
        title=request.subject,
        category=analysis.category.value,
        priority=analysis.priority.value,
        description=analysis.summary,
        approved_response=analysis.suggested_response,
    )
    db.add(ticket)
    audit(db, request_id, "ticket_approved_and_created", analysis_id=analysis.id)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = ticket_for(db, request_id)
        if existing:
            return existing
        raise
    return ticket
