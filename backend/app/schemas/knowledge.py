from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.workflow import Nonempty


class DocumentInput(BaseModel):
    title: Nonempty = Field(max_length=200)
    content: Nonempty = Field(max_length=100000)
    format: Literal["text", "markdown"] = "markdown"


class RetrievedSource(BaseModel):
    citation_id: str
    chunk_id: str
    document_id: str
    title: str
    excerpt: str
    similarity: float
    document_revision: int
    embedding_model: str
