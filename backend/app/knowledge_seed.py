"""Fictional demo policies; always seed a labelled offline index."""

from uuid import NAMESPACE_URL, uuid5

from app.models.entities import KnowledgeDocument
from app.schemas.knowledge import DocumentInput
from app.services.embeddings import MockEmbeddingService
from app.services.knowledge import index_document

SAMPLE_DOCUMENTS = [
    (
        "Refund Policy",
        "# Refund Policy\n\nFictional demonstration policy. Eligible subscriptions can be refunded within 14 days of purchase, subject to verification. A team member must verify the subscription, purchase date and eligibility before confirming a refund. This document does not authorize an automatic refund.",
    ),
    (
        "Billing Guidelines",
        "# Billing Guidelines\n\nFictional demonstration policy. Invoice disputes, discrepancies, duplicate payments and overcharges require billing team review before any adjustments are made. Verify the invoice and supporting payment records. Do not promise an adjustment before billing review.",
    ),
    (
        "Technical Support SLA",
        "# Technical Support SLA\n\nFictional demonstration policy. Critical service outages are escalated immediately. Normal technical support requests receive a response within one business day. Escalation is a support process, not a guarantee of a resolution time.",
    ),
]


def seed_knowledge(db):
    for title, content in SAMPLE_DOCUMENTS:
        document_id = str(uuid5(NAMESPACE_URL, "flowpilot-knowledge/" + title))
        if db.get(KnowledgeDocument, document_id):
            continue
        index_document(
            db,
            DocumentInput(title=title, content=content),
            MockEmbeddingService(),
            new_id=document_id,
        )
