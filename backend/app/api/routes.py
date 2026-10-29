from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select, text, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models.entities import (
    AIAnalysis,
    AuditEvent,
    Category,
    CustomerRequest,
    Priority,
    RequestStatus,
    now,
)
from app.repositories.requests import latest_analysis, ticket_for
from app.schemas.workflow import Approval, RequestCreate, ResponseEdit
from app.services.analysis import get_analysis_service
from app.services.analysis_errors import FAILURE_MESSAGES
from app.services.workflow import (
    analyse_request,
    approve_request,
    audit,
    require_request,
)

router = APIRouter(prefix="/api/v1")
DB = Depends(get_db)
ANALYSIS_SERVICE = Depends(get_analysis_service)


def record(row):
    if row is None:
        return None
    result = {
        column.name: getattr(row, column.name) for column in row.__table__.columns
    }
    for key, value in result.items():
        if isinstance(value, datetime):
            result[key] = value.replace(tzinfo=UTC) if value.tzinfo is None else value
    return result


def request_record(db, row):
    analysis_error = None
    if row.status == RequestStatus.failed:
        event = db.scalar(
            select(AuditEvent)
            .where(
                AuditEvent.request_id == row.id,
                AuditEvent.event_type == "ai_analysis_failed",
            )
            .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
            .limit(1)
        )
        reason = event.details.get("reason") if event else "provider_error"
        analysis_error = FAILURE_MESSAGES.get(
            reason, FAILURE_MESSAGES["provider_error"]
        )
    return {
        **record(row),
        "analysis": record(latest_analysis(db, row.id)),
        "ticket": record(ticket_for(db, row.id)),
        "analysis_error": analysis_error,
    }


@router.get("/health")
def health(db: Session = DB):
    db.execute(text("SELECT 1"))
    return {"status": "ok"}


@router.get("/config")
def config():
    return {
        "ai_provider": settings.ai_provider,
        "model_name": settings.openai_model
        if settings.ai_provider == "openai"
        else "mock-rules-v1",
        "human_approval_required": True,
        "provider_configured": settings.ai_provider == "mock"
        or bool(settings.openai_api_key.get_secret_value()),
        "storage": "SQLite"
        if settings.database_url.startswith("sqlite")
        else "PostgreSQL",
        "timeout_seconds": settings.ai_timeout_seconds,
    }


@router.post("/requests", status_code=201)
def create_request(payload: RequestCreate, db: Session = DB):
    row = CustomerRequest(**payload.model_dump())
    db.add(row)
    db.flush()
    audit(db, row.id, "request_received")
    db.commit()
    return request_record(db, row)


@router.get("/requests")
def list_requests(
    search: str = Query("", max_length=200),
    status: RequestStatus | None = None,
    priority: Priority | None = None,
    category: Category | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = DB,
):
    query = select(CustomerRequest)
    if search:
        pattern = (
            "%"
            + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            + "%"
        )
        query = query.where(
            or_(
                *[
                    column.ilike(pattern, escape="\\")
                    for column in [
                        CustomerRequest.subject,
                        CustomerRequest.sender_name,
                        CustomerRequest.sender_email,
                        CustomerRequest.body,
                    ]
                ]
            )
        )
    if status:
        query = query.where(CustomerRequest.status == status)
    if category or priority:
        latest_id = (
            select(AIAnalysis.id)
            .where(AIAnalysis.request_id == CustomerRequest.id)
            .order_by(AIAnalysis.created_at.desc(), AIAnalysis.id.desc())
            .limit(1)
            .correlate(CustomerRequest)
            .scalar_subquery()
        )
        query = query.join(AIAnalysis, AIAnalysis.id == latest_id)
        if category:
            query = query.where(AIAnalysis.category == category)
        if priority:
            query = query.where(AIAnalysis.priority == priority)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.scalars(
        query.order_by(CustomerRequest.created_at.desc(), CustomerRequest.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return {
        "items": [request_record(db, row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/requests/{request_id}")
def get_request(request_id: UUID, db: Session = DB):
    return request_record(db, require_request(db, str(request_id)))


@router.post("/requests/{request_id}/analyse")
def analyse(request_id: UUID, db: Session = DB, service=ANALYSIS_SERVICE):
    return record(analyse_request(db, str(request_id), service))


@router.patch("/analyses/{analysis_id}")
def edit_analysis(analysis_id: UUID, payload: ResponseEdit, db: Session = DB):
    analysis = db.get(AIAnalysis, str(analysis_id))
    if analysis is None:
        raise HTTPException(404, "Analysis not found")
    acquired = db.execute(
        update(CustomerRequest)
        .where(
            CustomerRequest.id == analysis.request_id,
            CustomerRequest.status == RequestStatus.needs_review,
        )
        .values(updated_at=now())
    ).rowcount
    latest = latest_analysis(db, analysis.request_id)
    if not acquired or latest.id != analysis.id:
        db.rollback()
        raise HTTPException(
            409, "Only the latest analysis awaiting review can be edited"
        )
    if analysis.suggested_response != payload.suggested_response:
        analysis.suggested_response = payload.suggested_response
        audit(
            db,
            analysis.request_id,
            "suggested_response_updated",
            analysis_id=analysis.id,
        )
    db.commit()
    return record(analysis)


@router.post("/requests/{request_id}/approve")
def approve(request_id: UUID, payload: Approval, db: Session = DB):
    return record(approve_request(db, str(request_id), payload))


@router.get("/activity")
def activity(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = DB,
):
    rows = db.execute(
        select(AuditEvent, CustomerRequest.subject)
        .outerjoin(CustomerRequest, CustomerRequest.id == AuditEvent.request_id)
        .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return {
        "items": [
            {**record(event), "request_subject": subject} for event, subject in rows
        ],
        "total": db.scalar(select(func.count()).select_from(AuditEvent)),
        "page": page,
        "page_size": page_size,
    }


@router.get("/dashboard/stats")
def dashboard(db: Session = DB):
    requests = db.scalars(select(CustomerRequest)).all()
    analyses = db.scalars(
        select(AIAnalysis).order_by(AIAnalysis.created_at, AIAnalysis.id)
    ).all()
    latest = {a.request_id: a for a in analyses}
    today = now().date()
    volume = [
        {
            "date": (today - timedelta(days=i)).isoformat(),
            "count": sum(
                r.created_at.date() == today - timedelta(days=i) for r in requests
            ),
        }
        for i in range(6, -1, -1)
    ]
    durations = [a.processing_duration_ms for a in analyses]
    return {
        "total_requests": len(requests),
        "processed_requests": len(latest),
        "needs_review": sum(r.status == RequestStatus.needs_review for r in requests),
        "completed_requests": sum(
            r.status == RequestStatus.completed for r in requests
        ),
        "average_processing_ms": round(sum(durations) / len(durations))
        if durations
        else None,
        "volume": volume,
        "categories": [
            {
                "category": c.value,
                "count": sum(a.category == c for a in latest.values()),
            }
            for c in Category
        ],
        "recent_requests": [
            request_record(db, r)
            for r in sorted(requests, key=lambda r: r.created_at, reverse=True)[:5]
        ],
    }
