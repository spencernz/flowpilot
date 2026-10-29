from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
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
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"


settings = Settings()
