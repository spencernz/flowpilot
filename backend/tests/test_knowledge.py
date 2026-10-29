import math
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from pydantic import SecretStr
from sqlalchemy import func, select

from app.core.config import settings
from app.main import app
from app.models.entities import KnowledgeChunk, KnowledgeDocument
from app.schemas.knowledge import DocumentInput
from app.services.analysis import (
    MockAnalysisService,
    OpenAIAnalysisService,
    get_analysis_service,
)
from app.services.embeddings import (
    EmbeddingError,
    MockEmbeddingService,
    OpenAIEmbeddingService,
    get_embedding_service,
)
from app.services.knowledge import chunk_text, cosine, index_document, retrieve

POLICY = {
    "title": "Refund Policy",
    "content": "Eligible subscriptions can receive a refund within 14 days, subject to verification. Human review is mandatory.",
    "format": "markdown",
}
REQUEST = {
    "sender_name": "Sam Example",
    "sender_email": "sam@example.com",
    "subject": "Subscription refund",
    "body": "I bought a subscription yesterday. Can I get a refund?",
}


def test_overlapping_chunks_preserve_input():
    assert chunk_text("abcdefghijklmno", 6, 2) == ["abcdef", "efghij", "ijklmn", "mno"]
    assert chunk_text("short", 100, 10) == ["short"]
    assert chunk_text("   ", 100, 10) == []
    with pytest.raises(ValueError):
        chunk_text("text", 5, 5)
    with pytest.raises(ValueError):
        chunk_text("x" * 1000, 2, 1)


def test_ingestion_api_validation_and_reindex(client, db_factory, monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", SecretStr(""))
    response = client.post("/api/v1/knowledge", json=POLICY)
    assert response.status_code == 201, response.text
    document = response.json()
    assert document["chunk_count"] == 1 and document[
        "active_embedding_model"
    ].startswith("mock:")
    did = document["id"]
    for _ in range(2):
        assert client.post(f"/api/v1/knowledge/{did}/reindex").status_code == 200
    with db_factory() as db:
        assert db.scalar(select(func.count()).select_from(KnowledgeChunk)) == 1
        assert db.scalar(select(func.count()).select_from(KnowledgeDocument)) == 1
    assert (
        client.get("/api/v1/knowledge").json()["items"][0]["content"]
        == POLICY["content"]
    )
    for invalid in [{**POLICY, "content": " "}, {**POLICY, "format": "pdf"}]:
        assert client.post("/api/v1/knowledge", json=invalid).status_code == 422
    assert (
        client.post(
            "/api/v1/knowledge/00000000-0000-0000-0000-000000000000/reindex"
        ).status_code
        == 404
    )


def test_cosine_and_exact_ranking(db_factory):
    assert cosine([1, 0], [1, 0]) == pytest.approx(1)
    assert cosine([1, 0], [0, 1]) == 0
    assert cosine([0, 0], [1, 0]) == 0
    assert cosine([math.nan], [1]) == 0
    assert cosine([1], [1, 2]) == 0

    class Vectors:
        identity = "test:two-dimensions"
        mode = "openai"

        def embed(self, texts):
            return [[1, 0] if "refund" in text else [0, 1] for text in texts]

    provider = Vectors()
    with db_factory() as db:
        refund = index_document(
            db, DocumentInput(title="refund", content="refund conditions"), provider
        )
        index_document(
            db, DocumentInput(title="outage", content="outage conditions"), provider
        )
        result = retrieve(db, "refund", provider, threshold=0.5)
        assert len(result) == 1 and result[0].document_id == refund.id
        assert result[0].citation_id == "S1" and result[0].similarity == pytest.approx(
            1
        )


def test_top_three_and_no_relevant_results(client):
    for i in range(4):
        client.post("/api/v1/knowledge", json={**POLICY, "title": f"Refund Policy {i}"})
    results = client.get(
        "/api/v1/knowledge/search", params={"q": "subscription refund"}
    ).json()
    assert len(results["items"]) == 3
    assert [s["citation_id"] for s in results["items"]] == ["S1", "S2", "S3"]
    assert all(s["embedding_model"].startswith("mock:") for s in results["items"])
    empty = client.get(
        "/api/v1/knowledge/search", params={"q": "astronomy quasars nebulae"}
    ).json()
    assert empty["items"] == [] and not empty["context_found"]
    assert (
        client.get("/api/v1/knowledge/search", params={"q": "   "}).status_code == 422
    )


def test_embedding_spaces_never_mix_and_query_not_sent_without_index(db_factory):
    with db_factory() as db:
        index_document(db, DocumentInput(**POLICY), MockEmbeddingService())

        class OtherProvider:
            identity = "openai:another-model:512"
            mode = "openai"

            def embed(self, texts):
                raise AssertionError("Must not query incompatible vectors")

        assert retrieve(db, "refund", OtherProvider()) == []


def test_invalid_embedding_or_outage_preserves_prior_index(client, db_factory):
    document = client.post("/api/v1/knowledge", json=POLICY).json()

    class Invalid:
        identity = MockEmbeddingService.identity
        mode = "mock"

        def embed(self, texts):
            return [[math.nan] for _ in texts]

    app.dependency_overrides[get_embedding_service] = lambda: Invalid()
    assert client.post(f"/api/v1/knowledge/{document['id']}/reindex").status_code == 502
    assert client.get("/api/v1/knowledge/search?q=refund").status_code == 502
    updated = client.patch(
        f"/api/v1/knowledge/{document['id']}",
        json={**POLICY, "content": "changed content"},
    )
    assert updated.status_code == 502
    with db_factory() as db:
        assert db.get(KnowledgeDocument, document["id"]).content == POLICY["content"]
        assert db.scalar(select(func.count()).select_from(KnowledgeChunk)) == 1

    class Unavailable(Invalid):
        def embed(self, texts):
            raise EmbeddingError("Embedding provider unavailable")

    app.dependency_overrides[get_embedding_service] = lambda: Unavailable()
    assert client.post("/api/v1/knowledge", json=POLICY).status_code == 502


def test_source_snapshot_survives_document_edits_and_human_approval(client):
    document = client.post("/api/v1/knowledge", json=POLICY).json()
    rid = client.post("/api/v1/requests", json=REQUEST).json()["id"]
    assert (
        client.post(
            f"/api/v1/requests/{rid}/approve",
            json={"approved": True, "analysis_id": "none"},
        ).status_code
        == 409
    )
    response = client.post(f"/api/v1/requests/{rid}/analyse")
    assert response.status_code == 200, response.text
    analysis = response.json()
    assert analysis["context_status"] == "found"
    assert analysis["citations"] == ["S1"]
    assert "[S1]" in analysis["suggested_response"]
    source = analysis["retrieved_sources"][0]
    assert (
        source["title"] == POLICY["title"] and source["document_id"] == document["id"]
    )
    assert source["excerpt"] == POLICY["content"]
    assert client.get(f"/api/v1/requests/{rid}").json()["ticket"] is None
    changed = client.patch(
        f"/api/v1/knowledge/{document['id']}",
        json={
            **POLICY,
            "content": "New policy: contact the billing team. No eligibility details are provided.",
        },
    )
    assert changed.status_code == 200, changed.text
    persisted = client.get(f"/api/v1/requests/{rid}").json()["analysis"]
    assert persisted["retrieved_sources"] == analysis["retrieved_sources"]
    bad = client.patch(
        f"/api/v1/analyses/{analysis['id']}",
        json={"suggested_response": "We offer automatic refunds [S999]."},
    )
    assert bad.status_code == 422
    edited = "We will verify subscription eligibility under the 14-day policy [S1]."
    assert (
        client.patch(
            f"/api/v1/analyses/{analysis['id']}", json={"suggested_response": edited}
        ).status_code
        == 200
    )
    payload = {"approved": True, "analysis_id": analysis["id"]}
    one = client.post(f"/api/v1/requests/{rid}/approve", json=payload).json()
    two = client.post(f"/api/v1/requests/{rid}/approve", json=payload).json()
    assert one["id"] == two["id"] and one["approved_response"] == edited


def test_no_context_is_explicit_and_citation_edits_are_recomputed(client):
    rid = client.post("/api/v1/requests", json=REQUEST).json()["id"]
    analysis = client.post(f"/api/v1/requests/{rid}/analyse").json()
    assert analysis["context_status"] == "no_relevant_sources"
    assert analysis["citations"] == [] and analysis["retrieved_sources"] == []
    assert analysis["human_verification_required"] is True
    assert "human verification" in analysis["suggested_response"].lower()
    client.post("/api/v1/knowledge", json=POLICY)
    analysis = client.post(f"/api/v1/requests/{rid}/analyse").json()
    result = client.patch(
        f"/api/v1/analyses/{analysis['id']}",
        json={"suggested_response": "A person will verify the policy."},
    ).json()
    assert result["citations"] == [] and result["human_verification_required"] is True


def test_fabricated_citations_are_rejected(client):
    rid = client.post("/api/v1/requests", json=REQUEST).json()["id"]

    class Fabricated(MockAnalysisService):
        def analyse(self, request, *, sources=None):
            result = super().analyse(request)
            result.suggested_response = "An automatic refund is approved [S99]."
            result.citations = ["S99"]
            return result

    app.dependency_overrides[get_analysis_service] = lambda: Fabricated()
    assert client.post(f"/api/v1/requests/{rid}/analyse").status_code == 502
    detail = client.get(f"/api/v1/requests/{rid}").json()
    assert (
        detail["status"] == "failed"
        and detail["analysis"] is None
        and detail["ticket"] is None
    )


def test_openai_embedding_sdk_shape_and_failures(monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", SecretStr("test-only"))
    provider = OpenAIEmbeddingService()
    with patch("app.services.embeddings.OpenAI") as constructor:
        sdk = constructor.return_value.__enter__.return_value
        sdk.embeddings.create.return_value = SimpleNamespace(
            data=[
                SimpleNamespace(index=1, embedding=[0.2] * 512),
                SimpleNamespace(index=0, embedding=[0.1] * 512),
            ]
        )
        vectors = provider.embed(["one", "two"])
        assert vectors[0] == [0.1] * 512
        assert sdk.embeddings.create.call_args.kwargs["dimensions"] == 512
        sdk.embeddings.create.side_effect = RuntimeError("private credential payload")
        with pytest.raises(EmbeddingError, match="unavailable") as err:
            provider.embed(["one"])
        assert "private credential" not in str(err.value)
    monkeypatch.setattr(settings, "openai_api_key", SecretStr(""))
    with pytest.raises(EmbeddingError, match="not configured"):
        provider.embed(["one"])


def test_openai_analysis_prompt_includes_only_retrieved_source_refs(monkeypatch):
    from app.schemas.knowledge import RetrievedSource

    monkeypatch.setattr(settings, "openai_api_key", SecretStr("test-only"))
    source = RetrievedSource(
        citation_id="S1",
        chunk_id="chunk-1",
        document_id="doc-1",
        title="Refund Policy",
        excerpt=POLICY["content"],
        similarity=0.8,
        document_revision=1,
        embedding_model="openai:test:512",
    )
    output = MockAnalysisService().analyse(SimpleNamespace(**REQUEST), sources=[source])
    with patch("app.services.analysis.OpenAI") as constructor:
        sdk = constructor.return_value.__enter__.return_value
        sdk.responses.parse.return_value = SimpleNamespace(output_parsed=output)
        result = OpenAIAnalysisService().analyse(
            SimpleNamespace(**REQUEST), sources=[source]
        )
        prompt = sdk.responses.parse.call_args.kwargs["input"]
        assert "untrusted" in prompt[0]["content"].lower()
        assert "UNTRUSTED RETRIEVED COMPANY EXCERPTS" in prompt[1]["content"]
        assert (
            source.excerpt in prompt[1]["content"]
            and '"citation_id": "S1"' in prompt[1]["content"]
        )
        assert result.citations == ["S1"]


def test_missing_active_index_is_distinguished_from_no_relevant_match(client):
    client.post("/api/v1/knowledge", json=POLICY)
    app.dependency_overrides[get_embedding_service] = OpenAIEmbeddingService
    result = client.get("/api/v1/knowledge/search?q=subscription%20refund").json()
    assert result["context_status"] == "index_unavailable"
    assert result["context_found"] is False and result["items"] == []
