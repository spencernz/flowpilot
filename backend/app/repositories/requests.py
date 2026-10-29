from sqlalchemy import select

from app.models.entities import AIAnalysis, SupportTicket


def latest_analysis(db, request_id):
    return db.scalar(
        select(AIAnalysis)
        .where(AIAnalysis.request_id == request_id)
        .order_by(AIAnalysis.created_at.desc(), AIAnalysis.id.desc())
        .limit(1)
    )


def ticket_for(db, request_id):
    return db.scalar(
        select(SupportTicket).where(SupportTicket.request_id == request_id)
    )
