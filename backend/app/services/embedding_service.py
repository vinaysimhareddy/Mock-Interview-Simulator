import hashlib
import logging
import math
import os
import time
from typing import Dict, List, Optional
from pydantic import SecretStr

from app.core.config import get_settings

logger = logging.getLogger("uvicorn.error")


def _deterministic_mock_embedding(text: str, dimensions: int) -> List[float]:
    """
    Generate a deterministic, unit-normalized pseudo-embedding for testing or offline mode.
    Ensures identical texts yield identical vectors with non-zero cosine similarity for overlapping tokens.
    """
    # Create a 256-bit seed from text
    h = hashlib.sha256(text.encode("utf-8")).digest()
    vec = [0.0] * dimensions
    words = text.lower().split()

    for i in range(dimensions):
        # Base pseudo-random float between -1.0 and 1.0 from hash bytes
        byte_val = h[i % len(h)]
        base = (byte_val / 127.5) - 1.0

        # Inject word-token signals into specific dimension buckets
        for w in words:
            w_hash = hashlib.md5(w.encode("utf-8")).digest()
            if (w_hash[0] * 256 + w_hash[1]) % dimensions == i:
                base += 1.5

        vec[i] = base

    # Normalize to unit length (L2 norm = 1.0)
    norm = math.sqrt(sum(x * x for x in vec))
    if norm > 0:
        vec = [x / norm for x in vec]
    return vec


class EmbeddingService:
    """
    Provider-switchable embedding service supporting OpenAI and Google Gemini models.
    Includes in-memory content-hash caching, batching, and backoff retries (§2.3).
    """

    def __init__(
        self,
        provider: Optional[str] = None,
        dimensions: Optional[int] = None,
        model: Optional[str] = None,
    ) -> None:
        self.settings = get_settings()
        self._cache: Dict[str, List[float]] = {}
        self._dimensions = dimensions or self.settings.EMBEDDING_DIMENSIONS
        self._provider = (provider or self.settings.EMBEDDING_PROVIDER).lower().strip()
        self._model = (model or self.settings.EMBEDDING_MODEL).strip()

    @property
    def dimensions(self) -> int:
        return self._dimensions

    @property
    def provider(self) -> str:
        return self._provider

    def _get_hash(self, text: str) -> str:
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    async def embed_query(self, text: str) -> List[float]:
        """Generate embedding vector for a single query string."""
        results = await self.embed_documents([text])
        return results[0]

    async def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """
        Embed a list of document strings with hash-based caching and batching.
        Returns vectors of length matching self.dimensions.
        """
        if not texts:
            return []

        results: List[Optional[List[float]]] = [None] * len(texts)
        missing_indices: List[int] = []
        missing_texts: List[str] = []

        for idx, text in enumerate(texts):
            h = self._get_hash(text)
            if h in self._cache:
                results[idx] = self._cache[h]
            else:
                missing_indices.append(idx)
                missing_texts.append(text)

        if missing_texts:
            # Batch call provider for uncached texts
            batch_size = 64
            computed_vectors: List[List[float]] = []

            for start in range(0, len(missing_texts), batch_size):
                batch = missing_texts[start : start + batch_size]
                vectors = await self._call_provider_with_retry(batch)
                computed_vectors.extend(vectors)

            # Store in cache and fill results
            for idx, vec in zip(missing_indices, computed_vectors):
                text = texts[idx]
                h = self._get_hash(text)
                self._cache[h] = vec
                results[idx] = vec

        return [v for v in results if v is not None]

    async def _call_provider_with_retry(self, texts: List[str]) -> List[List[float]]:
        """Call active provider with exponential backoff up to 3 attempts."""
        # Use deterministic mock embedding in test mode or if provider credentials are not configured
        is_test_env = bool(
            os.environ.get("PYTEST_CURRENT_TEST")
            or self.settings.ENVIRONMENT == "test"
            or os.environ.get("MOCK_EMBEDDINGS") == "1"
        )

        if is_test_env:
            return [_deterministic_mock_embedding(t, self._dimensions) for t in texts]

        max_attempts = 3
        delay = 0.5

        for attempt in range(1, max_attempts + 1):
            try:
                if self._provider == "openai":
                    return await self._call_openai(texts)
                elif self._provider == "google":
                    return await self._call_google(texts)
                else:
                    logger.warning(
                        "Unknown EMBEDDING_PROVIDER '%s'. Falling back to deterministic embedding.",
                        self._provider,
                    )
                    return [_deterministic_mock_embedding(t, self._dimensions) for t in texts]
            except Exception as exc:
                if attempt == max_attempts:
                    logger.error(
                        "Embedding call failed after %d attempts: %s. Using deterministic fallback.",
                        max_attempts,
                        exc,
                    )
                    return [_deterministic_mock_embedding(t, self._dimensions) for t in texts]
                logger.warning(
                    "Embedding provider attempt %d/%d failed: %s. Retrying in %.2fs...",
                    attempt,
                    max_attempts,
                    exc,
                    delay,
                )
                time.sleep(delay)
                delay *= 2.0

        return [_deterministic_mock_embedding(t, self._dimensions) for t in texts]

    async def _call_openai(self, texts: List[str]) -> List[List[float]]:
        if not self.settings.OPENAI_API_KEY:
            logger.warning("OPENAI_API_KEY missing. Falling back to deterministic embeddings.")
            return [_deterministic_mock_embedding(t, self._dimensions) for t in texts]

        from langchain_openai import OpenAIEmbeddings

        embedder = OpenAIEmbeddings(
            model=self._model or "text-embedding-3-small",
            api_key=SecretStr(self.settings.OPENAI_API_KEY),
            dimensions=self._dimensions,
        )
        return await embedder.aembed_documents(texts)

    async def _call_google(self, texts: List[str]) -> List[List[float]]:
        if not self.settings.GOOGLE_API_KEY:
            logger.warning("GOOGLE_API_KEY missing. Falling back to deterministic embeddings.")
            return [_deterministic_mock_embedding(t, self._dimensions) for t in texts]

        from langchain_google_genai import GoogleGenerativeAIEmbeddings

        if self._model and (self._model.startswith("models/") or "gemini" in self._model):
            model_name = self._model if self._model.startswith("models/") else f"models/{self._model}"
        else:
            model_name = "models/gemini-embedding-001"
        embedder = GoogleGenerativeAIEmbeddings(
            model=model_name,
            google_api_key=self.settings.GOOGLE_API_KEY,
        )
        vectors = await embedder.aembed_documents(texts)
        # Pad or slice to target dimensions if necessary
        return [self._fit_dimensions(v, self._dimensions) for v in vectors]

    def _fit_dimensions(self, vec: List[float], target_dim: int) -> List[float]:
        if len(vec) == target_dim:
            return vec
        elif len(vec) > target_dim:
            return vec[:target_dim]
        else:
            return vec + [0.0] * (target_dim - len(vec))

    def clear_cache(self) -> None:
        """Clear the in-memory embedding cache."""
        self._cache.clear()


# Global singleton instance
_embedding_service_instance: Optional[EmbeddingService] = None


def get_embedding_service() -> EmbeddingService:
    global _embedding_service_instance
    if _embedding_service_instance is None:
        _embedding_service_instance = EmbeddingService()
    return _embedding_service_instance
