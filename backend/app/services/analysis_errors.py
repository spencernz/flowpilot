"""Public failure messages; never forward raw provider errors or credentials."""

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AuthenticationError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitError,
)

from app.services.embeddings import EmbeddingError

FAILURE_MESSAGES = {
    "embedding_error": "Company knowledge retrieval failed because embeddings are unavailable or invalid. Check the embedding provider and model configuration; no ticket was created.",
    "model_unavailable": "The configured OpenAI model is unavailable or your project does not have access. Choose an accessible OPENAI_MODEL and restart the backend.",
    "authentication_error": "OpenAI rejected the API key. Check the backend OPENAI_API_KEY and restart the backend.",
    "quota_exceeded": "OpenAI API quota is exhausted. Check your project billing and usage limits before retrying.",
    "rate_limit": "OpenAI is rate limiting requests. Wait briefly and try again.",
    "permission_error": "Your OpenAI project does not have permission for this request. Check API key permissions and model access.",
    "timeout": "OpenAI analysis timed out. Try again or increase the backend AI_TIMEOUT_SECONDS setting.",
    "connection_error": "The backend cannot connect to OpenAI. Check the backend network connection and try again.",
    "invalid_output": "OpenAI returned an incomplete or invalid analysis. No ticket was created. Please try again.",
    "provider_error": "Analysis failed. Check provider configuration or try again.",
}


def failure_reason(exc: Exception) -> str:
    if isinstance(exc, EmbeddingError):
        return "embedding_error"
    if getattr(exc, "code", None) == "model_not_found" or isinstance(
        exc, NotFoundError
    ):
        return "model_unavailable"
    if isinstance(exc, AuthenticationError):
        return "authentication_error"
    if isinstance(exc, RateLimitError):
        return "quota_exceeded" if exc.code == "insufficient_quota" else "rate_limit"
    if isinstance(exc, PermissionDeniedError):
        return "permission_error"
    if isinstance(exc, APITimeoutError):
        return "timeout"
    if isinstance(exc, APIConnectionError):
        return "connection_error"
    if isinstance(exc, ValueError):
        return "invalid_output"
    if isinstance(exc, APIStatusError) and exc.status_code >= 500:
        return "provider_error"
    return "provider_error"
