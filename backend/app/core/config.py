from functools import lru_cache
import os
from pathlib import Path
from typing import List, Optional
import urllib.parse
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Single source of truth for auth collection
AUTH_COLLECTION: str = "auth"

# Single .env location: strictly backend/.env
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
_ENV_FILE = _BACKEND_DIR / ".env"


class Settings(BaseSettings):
    """Application settings loaded strictly from backend/.env environment variables."""

    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    # MongoDB Atlas Configuration - REQUIRED, no fallbacks or default URI
    MONGODB_URI: str = Field(
        ...,
        description="MongoDB connection string URI",
    )
    MONGODB_DB_NAME: str = Field(
        ...,
        description="Active MongoDB database name",
    )
    MONGODB_TEST_DB_NAME: str = Field(
        default="ai-mock-interview-test",
        description="MongoDB test database name for test isolation",
    )
    MONGODB_MAX_POOL_SIZE: int = Field(
        default=20,
        description="Maximum connection pool size",
    )
    MONGODB_MIN_POOL_SIZE: int = Field(
        default=1,
        description="Minimum connection pool size",
    )
    MONGODB_SERVER_SELECTION_TIMEOUT_MS: int = Field(
        default=8000,
        description="Server selection timeout in milliseconds",
    )
    MONGODB_CONNECT_TIMEOUT_MS: int = Field(
        default=8000,
        description="Socket connection timeout in milliseconds",
    )

    @field_validator("MONGODB_URI")
    @classmethod
    def validate_mongodb_uri(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("MONGODB_URI is required and cannot be empty. Set MONGODB_URI in backend/.env.")
        return v.strip()

    @field_validator("MONGODB_DB_NAME")
    @classmethod
    def validate_mongodb_db_name(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("MONGODB_DB_NAME is required and cannot be empty. Set MONGODB_DB_NAME in backend/.env.")
        return v.strip()
    MONGODB_SERVER_SELECTION_TIMEOUT_MS: int = Field(
        default=8000,
        description="Server selection timeout in milliseconds",
    )
    MONGODB_CONNECT_TIMEOUT_MS: int = Field(
        default=8000,
        description="Socket connection timeout in milliseconds",
    )

    # Security & Authentication
    JWT_SECRET: str = Field(
        default="changeme_replace_with_a_secure_random_hex_key_at_least_32_chars",
        description="Cryptographic secret key for JWT signing",
    )
    JWT_EXPIRE_MINUTES: int = Field(
        default=60,
        description="JWT expiration window in minutes",
    )
    CORS_ORIGINS: str = Field(
        default="http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173,http://127.0.0.1:3000",
        description="Comma-separated explicit origin whitelist",
    )

    # AI Provider Configuration ("openai" or "google")
    LLM_PROVIDER: str = Field(
        default="google",
        description="Active LLM provider: 'google' or 'openai'",
    )
    OPENAI_API_KEY: str = Field(
        default="",
        description="API key for OpenAI models",
    )
    GOOGLE_API_KEY: str = Field(
        default="",
        description="API key for Google Gemini models",
    )

    # Upload and Storage Limits
    MAX_UPLOAD_MB: int = Field(
        default=5,
        description="Maximum permitted resume upload size in megabytes",
    )

    # Server Configuration
    HOST: str = Field(
        default="0.0.0.0",
        description="Host interface to bind ASGI server",
    )
    PORT: int = Field(
        default=8000,
        description="Port for ASGI server",
    )
    ENVIRONMENT: str = Field(
        default="development",
        description="Deployment environment (development, test, production)",
    )
    INTEGRITY_MODE: str = Field(
        default="strict",
        description="Client camera integrity policy mode: 'off' | 'advisory' | 'strict'",
    )

    @property
    def cors_origin_list(self) -> List[str]:
        """Parse comma-delimited CORS_ORIGINS into a list of strings."""
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    def get_effective_mongodb_uri(self) -> str:
        """
        Return the effective MongoDB connection URI.
        Fails fast if MONGODB_URI is not set.
        """
        if self.MONGODB_URI and self.MONGODB_URI.strip():
            return self.MONGODB_URI.strip()

        raise ValueError("MONGODB_URI is required and cannot be empty. Set MONGODB_URI in backend/.env.")

    @property
    def mongodb_host(self) -> str:
        """Extract and return only the cluster hostname without any credentials."""
        try:
            uri = self.get_effective_mongodb_uri()
            parsed = urllib.parse.urlparse(uri)
            return parsed.hostname or "cluster0.qmgryia.mongodb.net"
        except Exception:
            return "unknown-host"

    @property
    def masked_mongodb_uri(self) -> str:
        """Return URI with credentials completely masked for safe representation."""
        try:
            uri = self.get_effective_mongodb_uri()
            parsed = urllib.parse.urlparse(uri)
            netloc = parsed.netloc
            if "@" in netloc:
                host_part = netloc.split("@")[-1]
                netloc = f"<masked>:<masked>@{host_part}"
            masked = parsed._replace(netloc=netloc)
            return urllib.parse.urlunparse(masked)
        except Exception:
            return "mongodb+srv://<masked>:<masked>@cluster0.qmgryia.mongodb.net"

    def __repr__(self) -> str:
        """Safe string representation masking all sensitive keys."""
        return (
            f"Settings("
            f"MONGODB_HOST={self.mongodb_host!r}, "
            f"MONGODB_DB_NAME={self.MONGODB_DB_NAME!r}, "
            f"ENVIRONMENT={self.ENVIRONMENT!r}, "
            f"LLM_PROVIDER={self.LLM_PROVIDER!r}"
            f")"
        )

    def __str__(self) -> str:
        return self.__repr__()


@lru_cache()
def get_settings() -> Settings:
    """Return cached instance of application settings."""
    return Settings()
