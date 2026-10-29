"""Idempotent synthetic fixtures; existing records are never reset."""

from datetime import timedelta
from uuid import NAMESPACE_URL, uuid5

from app.db.session import SessionLocal
from app.knowledge_seed import seed_knowledge
from app.models.entities import CustomerRequest, now
from app.schemas.workflow import Approval
from app.services.analysis import MockAnalysisService
from app.services.workflow import analyse_request, approve_request, audit

SAMPLES = [
    (
        "Sarah Mitchell",
        "Invoice discrepancy",
        "We were charged $1,250 instead of $950 on invoice INV-2026-1024. Please review the overcharge today.",
    ),
    (
        "Noah Williams",
        "Forgotten password",
        "I have forgotten my password. Could you help me reset it?",
    ),
    (
        "Ava Thompson",
        "Service outage",
        "Our entire team cannot reach the service. This outage is blocking all operations.",
    ),
    (
        "Olivia Brown",
        "Pricing enquiry",
        "Could you share pricing for five additional seats on our plan?",
    ),
    (
        "Liam Patel",
        "Refund request",
        "Please review a refund for our cancelled order, reference ORD-2048.",
    ),
    (
        "Mia Wilson",
        "Duplicate payment",
        "Our payment for invoice INV-2026-1076 was taken twice. Please investigate.",
    ),
    (
        "Emma Taylor",
        "Feature request",
        "Could you add CSV export to the reporting dashboard?",
    ),
    (
        "James Chen",
        "Account access issue",
        "I cannot log in after a password reset. I need access before the dispatch run.",
    ),
    (
        "Daniel Morgan",
        "Refund request — subscription purchased 45 days ago",
        "Hi team, I purchased my subscription 45 days ago and would like a refund because I no longer need it. The payment amount was correct and the service is working normally. Can you confirm whether I qualify for a refund under your standard refund policy? My receipt reference is ORD-DEMO-2045. Thanks, Daniel.",
    ),
]


def seed():
    with SessionLocal() as db:
        seed_knowledge(db)
        for i, (name, subject, body) in enumerate(SAMPLES):
            request_id = str(uuid5(NAMESPACE_URL, f"flowpilot-demo/{i}"))
            if db.get(CustomerRequest, request_id):
                continue
            created = now() - timedelta(days=i % 7, hours=1)
            row = CustomerRequest(
                id=request_id,
                sender_name=name,
                sender_email=name.lower().replace(" ", ".") + "@example.com",
                subject=subject,
                body=body,
                created_at=created,
                updated_at=created,
            )
            db.add(row)
            db.flush()
            audit(db, row.id, "request_received", synthetic=True)
            db.commit()
            if i in [0, 2, 3, 4, 5, 6]:
                analysis = analyse_request(db, row.id, MockAnalysisService())
                if i in [3, 6]:
                    approve_request(
                        db, row.id, Approval(approved=True, analysis_id=analysis.id)
                    )
    print(
        "Synthetic data ready (9 requests and 3 knowledge documents; existing records preserved)."
    )


if __name__ == "__main__":
    seed()
