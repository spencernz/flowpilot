"""Atomic document indexing and in-process cosine retrieval for a small corpus."""

import math

from fastapi import HTTPException
from sqlalchemy import delete, select, update

from app.core.config import settings
from app.models.entities import KnowledgeChunk, KnowledgeDocument, now
from app.schemas.knowledge import DocumentInput, RetrievedSource
from app.services.embeddings import validate_vectors


def chunk_text(content: str, size: int, overlap: int) -> list[str]:
    if size < 1 or overlap < 0 or overlap >= size:
        raise ValueError("Chunk overlap must be smaller than the chunk size.")
    # Character windows preserve Markdown verbatim and give deterministic overlap.
    chunks = []
    for start in range(0, len(content), size - overlap):
        text = content[start : start + size].strip()
        if text:
            chunks.append(text)
        if start + size >= len(content):
            break
    if len(chunks) > 300:
        raise ValueError("Document produces too many chunks. Increase the chunk size.")
    return chunks


def cosine(left, right):
    if len(left) != len(right) or not left:
        return 0.0
    if not all(
        isinstance(x, (float, int)) and math.isfinite(x) for x in [*left, *right]
    ):
        return 0.0
    denominator = math.sqrt(sum(x * x for x in left)) * math.sqrt(
        sum(x * x for x in right)
    )
    return (
        max(
            -1.0,
            min(
                1.0, sum(a * b for a, b in zip(left, right, strict=True)) / denominator
            ),
        )
        if denominator
        else 0.0
    )


def index_document(
    db, payload: DocumentInput, provider, document_id=None, *, new_id=None
):
    existing = db.get(KnowledgeDocument, document_id) if document_id else None
    if document_id and existing is None:
        raise HTTPException(404, "Knowledge document not found")
    revision = existing.revision if existing else None
    changed = bool(
        existing
        and (
            existing.content != payload.content
            or existing.title != payload.title
            or existing.format != payload.format
        )
    )
    parts = chunk_text(
        payload.content, settings.rag_chunk_chars, settings.rag_chunk_overlap
    )
    vectors = validate_vectors(
        provider.embed([f"{payload.title}\n{text}" for text in parts]), len(parts)
    )
    # Provider work finishes before writes; failed embeddings preserve the old document/index.
    try:
        if existing:
            acquired = db.execute(
                update(KnowledgeDocument)
                .where(
                    KnowledgeDocument.id == existing.id,
                    KnowledgeDocument.revision == revision,
                )
                .values(
                    title=payload.title,
                    content=payload.content,
                    format=payload.format,
                    revision=revision + 1,
                    updated_at=now(),
                )
            ).rowcount
            if not acquired:
                raise HTTPException(
                    409, "Document changed while indexing. Refresh and retry."
                )
            document = existing
            # An edit invalidates every old model index. A plain reindex replaces only this space.
            clause = KnowledgeChunk.document_id == document.id
            if not changed:
                clause = clause & (KnowledgeChunk.embedding_model == provider.identity)
            db.execute(delete(KnowledgeChunk).where(clause))
        else:
            document = KnowledgeDocument(
                title=payload.title, content=payload.content, format=payload.format
            )
            if new_id:
                document.id = new_id
            db.add(document)
            db.flush()
        db.add_all(
            [
                KnowledgeChunk(
                    document_id=document.id,
                    chunk_index=i,
                    text=text,
                    embedding=vector,
                    embedding_model=provider.identity,
                    document_revision=document.revision,
                )
                for i, (text, vector) in enumerate(zip(parts, vectors, strict=True))
            ]
        )
        db.commit()
        return document
    except Exception:
        db.rollback()
        raise


def retrieve(db, query, provider, threshold=None):
    rows = db.execute(
        select(KnowledgeChunk, KnowledgeDocument)
        .join(KnowledgeDocument, KnowledgeDocument.id == KnowledgeChunk.document_id)
        .where(KnowledgeChunk.embedding_model == provider.identity)
    ).all()
    if not rows:
        return []  # Empty or incompatible index needs no paid query embedding.
    # Bound worst-case UTF-8 token count below the embedding model's input limit.
    query_vector = validate_vectors(provider.embed([query[:1800]]), 1)[0]
    if provider.mode == "mock" and query_vector == [1.0] + [0.0] * 2047:
        return []
    limit = (
        threshold
        if threshold is not None
        else settings.rag_mock_min_similarity
        if provider.mode == "mock"
        else settings.rag_min_similarity
    )
    scored = [
        (cosine(query_vector, chunk.embedding), chunk, document)
        for chunk, document in rows
        if len(chunk.embedding) == len(query_vector)
    ]
    scored.sort(key=lambda item: (-item[0], item[1].id))
    return [
        RetrievedSource(
            citation_id=f"S{i + 1}",
            chunk_id=chunk.id,
            document_id=document.id,
            title=document.title,
            excerpt=chunk.text,
            similarity=round(score, 6),
            document_revision=chunk.document_revision,
            embedding_model=chunk.embedding_model,
        )
        for i, (score, chunk, document) in enumerate(
            [item for item in scored if item[0] > 0 and item[0] >= limit][:3]
        )
    ]


def context_status(db, provider, sources):
    if sources:
        return "found"
    has_documents = db.scalar(select(KnowledgeDocument.id).limit(1)) is not None
    has_index = (
        db.scalar(
            select(KnowledgeChunk.id)
            .where(KnowledgeChunk.embedding_model == provider.identity)
            .limit(1)
        )
        is not None
    )
    return (
        "index_unavailable"
        if has_documents and not has_index
        else "no_relevant_sources"
    )
