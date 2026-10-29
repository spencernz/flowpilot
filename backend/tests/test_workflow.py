from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from openai.lib._pydantic import to_strict_json_schema
from pydantic import SecretStr, ValidationError
from sqlalchemy import func, select

from app.core.config import settings
from app.main import app
from app.models.entities import (
    AIAnalysis,
    AuditEvent,
    CustomerRequest,
    RequestStatus,
    SupportTicket,
    now,
)
from app.schemas.workflow import AnalysisOutput, Approval
from app.services.analysis import (
    MockAnalysisService,
    OpenAIAnalysisService,
    get_analysis_service,
)
from app.services.workflow import approve_request

PAYLOAD = {
    "sender_name": "Sarah Mitchell",
    "sender_email": "sarah@example.com",
    "subject": "Invoice discrepancy",
    "body": "I was charged $1,250 instead of $950 for invoice INV-2026-1024.",
}


def create(client):
    response = client.post("/api/v1/requests", json=PAYLOAD)
    assert response.status_code == 201, response.text
    return response.json()


def analyse(client, request_id):
    result = client.post(f"/api/v1/requests/{request_id}/analyse")
    assert result.status_code == 200, result.text
    return result.json()


def test_creation_validation_and_search(client):
    row = create(client)
    assert row["status"] == "new"
    assert row["created_at"].endswith("Z") or row["created_at"].endswith("+00:00")
    for field, value in [
        ("sender_email", "invalid"),
        ("subject", "  "),
        ("body", ""),
        ("sender_name", "x" * 121),
    ]:
        invalid = {**PAYLOAD, field: value}
        response = client.post("/api/v1/requests", json=invalid)
        assert response.status_code == 422
        assert "error" in response.json()
    assert (
        client.get("/api/v1/requests", params={"search": "1250"}).json()["total"] == 0
    )
    assert (
        client.get("/api/v1/requests", params={"search": "Sarah"}).json()["total"] == 1
    )
    assert (
        client.get("/api/v1/requests", params={"search": "1,250"}).json()["total"] == 1
    )
    assert client.get("/api/v1/requests", params={"search": "%"}).json()["total"] == 0
    assert client.get("/api/v1/requests", params={"page": 0}).status_code == 422


def test_schema_validation_and_strict_openai_shape():
    output = MockAnalysisService().analyse(SimpleNamespace(**PAYLOAD))
    assert output.extracted_entities.invoice_number == "INV-2026-1024"
    assert output.extracted_entities.charged_amount == 1250
    for invalid in [
        {"category": "invalid"},
        {"priority": "critical"},
        {"suggested_response": ""},
        {"surprise": "bad"},
    ]:
        with pytest.raises(ValidationError):
            AnalysisOutput.model_validate({**output.model_dump(), **invalid})
    schema = to_strict_json_schema(AnalysisOutput)
    assert schema["additionalProperties"] is False
    assert schema["$defs"]["Entities"]["additionalProperties"] is False
    assert set(schema["$defs"]["Entities"]["required"]) == set(
        schema["$defs"]["Entities"]["properties"]
    )


def test_mock_analysis_then_edit_approve_idempotently(client, db_factory):
    row = create(client)
    rid = row["id"]
    analysis = analyse(client, rid)
    assert analysis["category"] == "billing" and analysis["priority"] == "high"
    assert analysis["confidence"] is None
    assert analysis["model_name"] == "mock-rules-v1"
    detail = client.get(f"/api/v1/requests/{rid}").json()
    assert detail["status"] == "needs_review" and detail["ticket"] is None
    edit = client.patch(
        f"/api/v1/analyses/{analysis['id']}",
        json={
            "suggested_response": "Hi Sarah, our team will investigate the discrepancy."
        },
    )
    assert edit.status_code == 200
    payload = {"approved": True, "analysis_id": analysis["id"]}
    approved = client.post(f"/api/v1/requests/{rid}/approve", json=payload)
    assert approved.status_code == 200, approved.text
    again = client.post(f"/api/v1/requests/{rid}/approve", json=payload)
    assert approved.json()["id"] == again.json()["id"]
    assert approved.json()["approved_response"].startswith("Hi Sarah,")
    assert client.get(f"/api/v1/requests/{rid}").json()["status"] == "completed"
    assert (
        client.patch(
            f"/api/v1/analyses/{analysis['id']}", json={"suggested_response": "Changed"}
        ).status_code
        == 409
    )
    assert client.post(f"/api/v1/requests/{rid}/analyse").status_code == 409
    with db_factory() as db:
        assert db.scalar(select(func.count()).select_from(SupportTicket)) == 1
    types = [e["event_type"] for e in client.get("/api/v1/activity").json()["items"]]
    assert sorted(types) == sorted(
        [
            "request_received",
            "ai_analysis_started",
            "ai_analysis_completed",
            "suggested_response_updated",
            "ticket_approved_and_created",
        ]
    )
    assert types.count("ticket_approved_and_created") == 1
    assert "body" not in str(client.get("/api/v1/activity").json())


def test_reject_unapproved_stale_and_missing_analysis(client):
    rid = create(client)["id"]
    assert (
        client.post(
            f"/api/v1/requests/{rid}/approve",
            json={"approved": True, "analysis_id": "missing"},
        ).status_code
        == 409
    )
    first = analyse(client, rid)
    second = analyse(client, rid)
    assert (
        client.patch(
            f"/api/v1/analyses/{first['id']}", json={"suggested_response": "stale edit"}
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/api/v1/requests/{rid}/approve",
            json={"approved": True, "analysis_id": first["id"]},
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/api/v1/requests/{rid}/approve",
            json={"approved": False, "analysis_id": second["id"]},
        ).status_code
        == 422
    )
    assert client.get(f"/api/v1/requests/{rid}").json()["status"] == "needs_review"


def test_failure_is_recorded_and_retryable(client):
    rid = create(client)["id"]

    class Broken:
        model_name = "broken"

        def analyse(self, request):
            raise RuntimeError("secret-provider-error")

    app.dependency_overrides[get_analysis_service] = lambda: Broken()
    response = client.post(f"/api/v1/requests/{rid}/analyse")
    assert response.status_code == 502
    assert "secret-provider-error" not in response.text
    assert client.get(f"/api/v1/requests/{rid}").json()["status"] == "failed"
    assert (
        client.get("/api/v1/activity").json()["items"][0]["event_type"]
        == "ai_analysis_failed"
    )
    app.dependency_overrides.pop(get_analysis_service)
    assert analyse(client, rid)["category"] == "billing"


def test_invalid_provider_output_rejected(client):
    rid = create(client)["id"]

    class Invalid:
        model_name = "malformed"

        def analyse(self, request):
            return {"category": "not-real"}

    app.dependency_overrides[get_analysis_service] = lambda: Invalid()
    assert client.post(f"/api/v1/requests/{rid}/analyse").status_code == 502
    assert client.get(f"/api/v1/requests/{rid}").json()["analysis"] is None


def test_dashboard_and_filters(client):
    empty = client.get("/api/v1/dashboard/stats").json()
    assert empty["total_requests"] == 0 and empty["average_processing_ms"] is None
    row = create(client)
    analysis = analyse(client, row["id"])
    stats = client.get("/api/v1/dashboard/stats").json()
    assert (
        stats["total_requests"] == 1
        and stats["processed_requests"] == 1
        and stats["needs_review"] == 1
    )
    assert stats["average_processing_ms"] >= 1
    assert sum(x["count"] for x in stats["volume"]) == 1
    assert (
        client.get(
            "/api/v1/requests?category=billing&priority=high&status=needs_review"
        ).json()["total"]
        == 1
    )
    assert client.get("/api/v1/requests?priority=urgent").json()["total"] == 0
    client.post(
        f"/api/v1/requests/{row['id']}/approve",
        json={"approved": True, "analysis_id": analysis["id"]},
    )
    final = client.get("/api/v1/dashboard/stats").json()
    assert final["completed_requests"] == 1 and final["needs_review"] == 0


def test_concurrent_approval_creates_one_ticket(client, db_factory):
    rid = create(client)["id"]
    analysis = analyse(client, rid)

    def approve(_):
        with db_factory() as db:
            return approve_request(
                db, rid, Approval(approved=True, analysis_id=analysis["id"])
            ).id

    with ThreadPoolExecutor(max_workers=4) as executor:
        ids = list(executor.map(approve, range(4)))
    assert len(set(ids)) == 1
    with db_factory() as db:
        assert db.scalar(select(func.count()).select_from(SupportTicket)) == 1
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditEvent)
                .where(AuditEvent.event_type == "ticket_approved_and_created")
            )
            == 1
        )


def test_processing_lease_and_crash_recovery(client, db_factory):
    rid = create(client)["id"]
    with db_factory() as db:
        r = db.get(CustomerRequest, rid)
        r.status = RequestStatus.processing
        r.updated_at = now()
        db.commit()
    assert client.post(f"/api/v1/requests/{rid}/analyse").status_code == 409
    with db_factory() as db:
        db.get(CustomerRequest, rid).updated_at = now() - timedelta(minutes=6)
        db.commit()
    assert analyse(client, rid)["id"]


def test_missing_request_and_safe_config(client):
    assert (
        client.get("/api/v1/requests/00000000-0000-0000-0000-000000000000").status_code
        == 404
    )
    assert client.get("/api/v1/health").json() == {"status": "ok"}
    config = client.get("/api/v1/config").json()
    assert config["human_approval_required"] is True
    assert "api_key" not in config


def test_openai_sdk_contract_without_paid_call(monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", SecretStr("test-key"))
    output = MockAnalysisService().analyse(SimpleNamespace(**PAYLOAD))
    with patch("app.services.analysis.OpenAI") as constructor:
        sdk = constructor.return_value.__enter__.return_value
        sdk.responses.parse.return_value = SimpleNamespace(output_parsed=output)
        result = OpenAIAnalysisService().analyse(SimpleNamespace(**PAYLOAD))
        assert result == output
        call = sdk.responses.parse.call_args.kwargs
        assert call["text_format"] is AnalysisOutput and call["store"] is False
        assert "untrusted" in call["input"][0]["content"]
        assert constructor.call_args.kwargs["max_retries"] == 0
        sdk.responses.parse.return_value = SimpleNamespace(output_parsed=None)
        with pytest.raises(ValueError):
            OpenAIAnalysisService().analyse(SimpleNamespace(**PAYLOAD))


def test_seed_repeatable(db_factory, monkeypatch):
    import app.seed as seed_module

    monkeypatch.setattr(seed_module, "SessionLocal", db_factory)
    seed_module.seed()
    seed_module.seed()
    with db_factory() as db:
        assert db.scalar(select(func.count()).select_from(CustomerRequest)) == 8
        assert db.scalar(select(func.count()).select_from(SupportTicket)) == 2
        assert db.scalar(select(func.count()).select_from(AIAnalysis)) == 6
