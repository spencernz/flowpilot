from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.routes import record
from app.db.session import get_db
from app.models.entities import KnowledgeChunk, KnowledgeDocument
from app.schemas.knowledge import DocumentInput
from app.services.embeddings import EmbeddingError, get_embedding_service
from app.services.knowledge import context_status, index_document, retrieve

router = APIRouter(prefix="/api/v1/knowledge", tags=["knowledge"])
DB = Depends(get_db)
EMBEDDINGS = Depends(get_embedding_service)


def document_record(db, document, provider):
    chunks = db.scalars(
        select(KnowledgeChunk).where(KnowledgeChunk.document_id == document.id)
    ).all()
    return {
        **record(document),
        "chunk_count": sum(
            chunk.embedding_model == provider.identity for chunk in chunks
        ),
        "indexed_models": sorted({chunk.embedding_model for chunk in chunks}),
        "active_embedding_model": provider.identity,
    }


def index_or_error(db, payload, provider, document_id=None):
    try:
        return index_document(db, payload, provider, document_id)
    except EmbeddingError as exc:
        db.rollback()
        raise HTTPException(502, str(exc)) from None
    except ValueError as exc:
        db.rollback()
        raise HTTPException(422, str(exc)) from None


@router.get("")
def list_documents(db: Session = DB, provider=EMBEDDINGS):
    rows = db.scalars(
        select(KnowledgeDocument).order_by(KnowledgeDocument.created_at.desc())
    ).all()
    return {
        "items": [document_record(db, row, provider) for row in rows],
        "embedding_model": provider.identity,
        "mode": provider.mode,
    }


@router.post("", status_code=201)
def create_document(payload: DocumentInput, db: Session = DB, provider=EMBEDDINGS):
    return document_record(db, index_or_error(db, payload, provider), provider)


@router.get("/search")
def search(
    q: str = Query(min_length=1, max_length=1800), db: Session = DB, provider=EMBEDDINGS
):
    if not q.strip():
        raise HTTPException(422, "Enter a search query")
    try:
        sources = retrieve(db, q, provider)
    except EmbeddingError as exc:
        raise HTTPException(502, str(exc)) from None
    return {
        "items": [source.model_dump() for source in sources],
        "context_found": bool(sources),
        "context_status": context_status(db, provider, sources),
        "embedding_model": provider.identity,
        "mode": provider.mode,
    }


@router.patch("/{document_id}")
def update_document(
    document_id: UUID, payload: DocumentInput, db: Session = DB, provider=EMBEDDINGS
):
    # Content edits re-index atomically; previous analysis snapshots stay immutable.
    return document_record(
        db, index_or_error(db, payload, provider, str(document_id)), provider
    )


@router.post("/{document_id}/reindex")
def reindex(document_id: UUID, db: Session = DB, provider=EMBEDDINGS):
    document = db.get(KnowledgeDocument, str(document_id))
    if document is None:
        raise HTTPException(404, "Knowledge document not found")
    payload = DocumentInput(
        title=document.title, content=document.content, format=document.format
    )
    return document_record(
        db, index_or_error(db, payload, provider, document.id), provider
    )
