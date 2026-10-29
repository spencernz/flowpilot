"""Small, explicit embedding providers. No mock/real vector compatibility."""

import hashlib
import math
import re
from typing import Protocol

from openai import OpenAI

from app.core.config import settings


class EmbeddingError(Exception):
    """Safe error boundary for indexing/retrieval failures."""


class EmbeddingService(Protocol):
    identity: str
    mode: str

    def embed(self, texts: list[str]) -> list[list[float]]: ...


def validate_vectors(vectors, count):
    if len(vectors) != count:
        raise EmbeddingError("Embedding provider returned the wrong number of vectors.")
    size = len(vectors[0]) if vectors else 0
    if not size or any(
        len(v) != size
        or not all(
            isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)
            for x in v
        )
        or not any(v)
        for v in vectors
    ):
        raise EmbeddingError("Embedding provider returned invalid vectors.")
    return vectors


class MockEmbeddingService:
    identity = "mock:lexical-hash-v1:2048"
    mode = "mock"

    def embed(self, texts):
        stop = {
            "a",
            "an",
            "the",
            "to",
            "of",
            "in",
            "on",
            "for",
            "is",
            "are",
            "be",
            "we",
            "i",
            "my",
            "our",
            "your",
            "us",
            "and",
            "or",
            "with",
            "this",
            "that",
            "it",
            "as",
            "by",
            "at",
            "can",
            "could",
            "please",
            "need",
            "have",
            "has",
            "from",
            "will",
            "would",
            "should",
            "not",
            "any",
            "all",
            "company",
            "policy",
            "guidelines",
            "fictional",
            "demonstration",
            "support",
            "request",
            "customer",
            "team",
            "review",
            "information",
            "about",
            "subject",
            "message",
            "thanks",
            "hi",
        }
        synonyms = {
            "refunds": "refund",
            "refunded": "refund",
            "reimbursement": "refund",
            "invoices": "invoice",
            "billing": "invoice",
            "disputes": "dispute",
            "adjustments": "adjustment",
            "outages": "outage",
            "critical": "outage",
            "subscriptions": "subscription",
            "cancelled": "cancel",
            "cancellation": "cancel",
        }
        result = []
        for text in texts:
            vector = [0.0] * 2048
            for word in re.findall(r"[a-z0-9]+", text.lower()):
                if word in stop or len(word) < 3:
                    continue
                word = synonyms.get(word, word)
                slot = (
                    int.from_bytes(hashlib.sha256(word.encode()).digest()[:4], "big")
                    % 2048
                )
                vector[slot] += 1
            # A valid non-zero vector for stopword-only text; it never matches useful content.
            if not any(vector):
                vector[0] = 1
            result.append(vector)
        return validate_vectors(result, len(texts))


class OpenAIEmbeddingService:
    mode = "openai"

    def __init__(self):
        self.model = settings.embedding_model
        self.identity = f"openai:{self.model}:512"

    def embed(self, texts):
        if not settings.openai_api_key.get_secret_value():
            raise EmbeddingError(
                "OpenAI embeddings are not configured. Add the backend API key or use mock mode."
            )
        try:
            with OpenAI(
                api_key=settings.openai_api_key.get_secret_value(),
                timeout=settings.ai_timeout_seconds,
                max_retries=0,
            ) as client:
                vectors = []
                for start in range(0, len(texts), 32):
                    batch = texts[start : start + 32]
                    response = client.embeddings.create(
                        model=self.model,
                        input=batch,
                        dimensions=512,
                        encoding_format="float",
                    )
                    items = sorted(response.data, key=lambda item: item.index)
                    if [item.index for item in items] != list(range(len(batch))):
                        raise EmbeddingError(
                            "Embedding provider returned invalid vector indexes."
                        )
                    vectors.extend(item.embedding for item in items)
            vectors = validate_vectors(vectors, len(texts))
            if any(len(vector) != 512 for vector in vectors):
                raise EmbeddingError(
                    "Embedding provider returned unexpected dimensions."
                )
            return vectors
        except EmbeddingError:
            raise
        except Exception as exc:
            if getattr(exc, "code", None) == "model_not_found":
                raise EmbeddingError(
                    "The configured OpenAI embedding model is unavailable to this project. Enable embedding model access or use a backend API key with access, then re-index the documents."
                ) from exc
            raise EmbeddingError(
                "OpenAI embeddings are unavailable. Check EMBEDDING_MODEL access, API configuration and connectivity, then retry."
            ) from exc


def get_embedding_service() -> EmbeddingService:
    return (
        MockEmbeddingService()
        if settings.ai_provider == "mock"
        else OpenAIEmbeddingService()
    )
