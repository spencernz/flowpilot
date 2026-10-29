from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints

from app.models.entities import Category, Priority

Nonempty = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class RequestCreate(BaseModel):
    sender_name: Nonempty = Field(max_length=120)
    sender_email: EmailStr = Field(max_length=254)
    subject: Nonempty = Field(max_length=240)
    body: Nonempty = Field(max_length=20000)


class Entities(BaseModel):
    model_config = ConfigDict(extra="forbid")
    invoice_number: str | None
    charged_amount: float | None
    expected_amount: float | None
    currency: str | None
    account_reference: str | None
    requested_seats: int | None
    issue: str | None


class AnalysisOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category: Category
    priority: Priority
    summary: Nonempty = Field(max_length=4000)
    customer_intent: Nonempty = Field(max_length=2000)
    extracted_entities: Entities
    suggested_response: Nonempty = Field(max_length=10000)
    citations: list[str] = Field(default_factory=list, max_length=3)
    human_verification_required: bool = True


class ResponseEdit(BaseModel):
    suggested_response: Nonempty = Field(max_length=10000)


class Approval(BaseModel):
    approved: bool
    analysis_id: str
