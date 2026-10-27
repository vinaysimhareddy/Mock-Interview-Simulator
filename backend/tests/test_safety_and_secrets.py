import os
import re
import pytest
from pathlib import Path

from app.core.config import get_settings
from app.core.database import mongo_manager

settings = get_settings()


@pytest.mark.asyncio
async def test_production_database_safety_guard() -> None:
    """Verify that attempting to connect to or clean the production database in tests raises RuntimeError."""
    # 1. Connecting with production database name in test environment MUST raise RuntimeError
    with pytest.raises(RuntimeError) as exc_info:
        await mongo_manager.connect(override_db_name=settings.MONGODB_DB_NAME)
    assert "CRITICAL SAFETY VIOLATION" in str(exc_info.value)
    assert settings.MONGODB_DB_NAME in str(exc_info.value)

    # 2. Connecting with test database name must NOT raise the safety guard
    # (it connects to Atlas or uses in-memory fallback safely)
    db = await mongo_manager.connect(override_db_name=settings.MONGODB_TEST_DB_NAME)
    assert db is not None


def test_gitignore_and_dockerignore_protect_env_secrets() -> None:
    """Verify that .env is explicitly excluded in .gitignore and .dockerignore files."""
    root_dir = Path(__file__).resolve().parent.parent.parent
    backend_dir = root_dir / "backend"

    # 1. Check root .gitignore
    root_gitignore = root_dir / ".gitignore"
    assert root_gitignore.exists(), "Root .gitignore must exist"
    root_gi_content = root_gitignore.read_text(encoding="utf-8")
    assert any(line.strip() in (".env*", ".env") for line in root_gi_content.splitlines()), (
        "Root .gitignore must ignore .env files"
    )

    # 2. Check backend .gitignore
    backend_gitignore = backend_dir / ".gitignore"
    assert backend_gitignore.exists(), "backend/.gitignore must exist"
    backend_gi_content = backend_gitignore.read_text(encoding="utf-8")
    assert any(line.strip() in (".env*", ".env") for line in backend_gi_content.splitlines()), (
        "backend/.gitignore must ignore .env files"
    )

    # 3. Check .dockerignore files
    root_dockerignore = root_dir / ".dockerignore"
    if root_dockerignore.exists():
        content = root_dockerignore.read_text(encoding="utf-8")
        assert ".env" in content, "Root .dockerignore must ignore .env"

    backend_dockerignore = backend_dir / ".dockerignore"
    if backend_dockerignore.exists():
        b_content = backend_dockerignore.read_text(encoding="utf-8")
        assert ".env" in b_content, "backend/.dockerignore must ignore .env"


def test_secret_scanner_no_live_passwords_in_tracked_files() -> None:
    """
    Scan all project files to guarantee that no real password pattern
    matching 'mongodb+srv://[^<\\s]+:[^<\\s@]+@' appears anywhere in the codebase (§M5).
    """
    root_dir = Path(__file__).resolve().parent.parent.parent
    secret_pattern = re.compile(r"mongodb\+srv://[^<\s]+:[^<\s@]+@")

    ignored_dirs = {
        ".git",
        "venv",
        ".venv",
        "node_modules",
        "__pycache__",
        ".pytest_cache",
        ".mypy_cache",
        "dist",
        "build",
        "coverage",
        ".system_generated",
    }

    leaks = []

    for dirpath, dirnames, filenames in os.walk(root_dir):
        # Prune ignored directory trees
        dirnames[:] = [d for d in dirnames if d not in ignored_dirs]

        for fname in filenames:
            # Skip untracked local environment files, media, and binary files
            if fname.startswith(".env") and not fname.endswith(".example"):
                continue
            if fname.endswith((".pyc", ".png", ".jpg", ".webp", ".pdf", ".task", ".ico", ".log")):
                continue

            filepath = Path(dirpath) / fname
            try:
                content = filepath.read_text(encoding="utf-8", errors="ignore")
                matches = secret_pattern.findall(content)
                if matches:
                    rel_path = filepath.relative_to(root_dir)
                    leaks.append(f"{rel_path}: {matches}")
            except Exception:
                pass

    assert not leaks, f"Live MongoDB credentials found in repository files: {leaks}"
