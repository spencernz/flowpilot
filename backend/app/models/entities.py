import enum
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import JSON, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


def now():
    return datetime.now(UTC)


def uid():
    return str(uuid4())


class RequestStatus(str, enum.Enum):
    new = "new"
    processing = "processing"
    needs_review = "needs_review"
    completed = "completed"
    failed = "failed"


class TicketStatus(str, enum.Enum):
    open = "open"


class Category(str, enum.Enum):
    billing = "billing"
    technical_support = "technical_support"
    sales = "sales"
    general = "general"
    other = "other"


class Priority(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    urgent = "urgent"


class CustomerRequest(Base):
    __tablename__ = "customer_requests"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    sender_name: Mapped[str] = mapped_column(String(120))
    sender_email: Mapped[str] = mapped_column(String(254))
    subject: Mapped[str] = mapped_column(String(240))
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[RequestStatus] = mapped_column(
        Enum(RequestStatus), default=RequestStatus.new, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now, onupdate=now
    )


class AIAnalysis(Base):
    __tablename__ = "ai_analyses"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    request_id: Mapped[str] = mapped_column(
        ForeignKey("customer_requests.id"), index=True
    )
    category: Mapped[Category] = mapped_column(Enum(Category))
    priority: Mapped[Priority] = mapped_column(Enum(Priority))
    summary: Mapped[str] = mapped_column(Text)
    customer_intent: Mapped[str] = mapped_column(Text)
    extracted_entities: Mapped[dict] = mapped_column(JSON)
    suggested_response: Mapped[str] = mapped_column(Text)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    model_name: Mapped[str] = mapped_column(String(120))
    processing_duration_ms: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now, index=True
    )


class SupportTicket(Base):
    __tablename__ = "support_tickets"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    request_id: Mapped[str] = mapped_column(
        ForeignKey("customer_requests.id"), unique=True
    )
    analysis_id: Mapped[str] = mapped_column(ForeignKey("ai_analyses.id"))
    title: Mapped[str] = mapped_column(String(240))
    category: Mapped[str] = mapped_column(String(40))
    priority: Mapped[str] = mapped_column(String(20))
    description: Mapped[str] = mapped_column(Text)
    approved_response: Mapped[str] = mapped_column(Text)
    status: Mapped[TicketStatus] = mapped_column(
        Enum(TicketStatus), default=TicketStatus.open
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    request_id: Mapped[str | None] = mapped_column(
        ForeignKey("customer_requests.id"), nullable=True, index=True
    )
    event_type: Mapped[str] = mapped_column(String(80))
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now, index=True
    )
