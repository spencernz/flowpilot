from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(Path(__file__).resolve().parents[3] / ".env"), extra="ignore"
    )
    database_url: str = "sqlite:///./flowpilot.db"
    ai_provider: Literal["mock", "openai"] = "mock"
    openai_model: str = "gpt-4.1-mini"
    openai_api_key: SecretStr = SecretStr("")
    ai_timeout_seconds: float = Field(default=30, ge=1, le=120)
    embedding_model: str = Field(
        default="text-embedding-3-small", min_length=1, max_length=100
    )
    rag_chunk_chars: int = Field(default=1200, ge=200, le=4000)
    rag_chunk_overlap: int = Field(default=200, ge=0, le=1000)
    rag_min_similarity: float = Field(default=0.35, ge=0, le=1)
    rag_mock_min_similarity: float = Field(default=0.15, ge=0, le=1)
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @model_validator(mode="after")
    def valid_chunk_limits(self):
        if self.rag_chunk_overlap >= self.rag_chunk_chars:
            raise ValueError("RAG_CHUNK_OVERLAP must be smaller than RAG_CHUNK_CHARS")
        return self


settings = Settings()
