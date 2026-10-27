import sys
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from scripts.check_db import check_database


@pytest.mark.asyncio
async def test_check_database_success_creates_auth_if_missing(capsys: pytest.CaptureFixture) -> None:
    """Verify check_database lists collections and creates auth if missing."""
    mock_client = MagicMock()
    mock_admin = MagicMock()
    mock_admin.command = AsyncMock(return_value={"ok": 1.0})
    mock_client.admin = mock_admin

    mock_db = MagicMock()
    # Initially missing "auth"
    mock_db.list_collection_names = AsyncMock(
        side_effect=[["resumes", "interview_sessions"], ["resumes", "interview_sessions", "auth"]]
    )
    mock_db.create_collection = AsyncMock()
    mock_client.__getitem__.return_value = mock_db

    with patch("scripts.check_db.AsyncIOMotorClient", return_value=mock_client):
        exit_code = await check_database()
        assert exit_code == 0

    captured = capsys.readouterr()
    assert "Ping result: 1.0 (OK" in captured.out
    assert "Target Database: ai-mock-interview" in captured.out
    assert "Collection 'auth' is missing. Creating 'auth' collection..." in captured.out
    assert "Collection 'auth': Created successfully." in captured.out
    mock_db.create_collection.assert_awaited_once_with("auth")

    # Ensure zero credentials printed
    assert "mongodb+srv://" not in captured.out
    assert "@" not in captured.out


@pytest.mark.asyncio
async def test_check_database_success_when_auth_already_exists(capsys: pytest.CaptureFixture) -> None:
    """Verify check_database confirms existing auth collection without re-creating."""
    mock_client = MagicMock()
    mock_admin = MagicMock()
    mock_admin.command = AsyncMock(return_value={"ok": 1.0})
    mock_client.admin = mock_admin

    mock_db = MagicMock()
    mock_db.list_collection_names = AsyncMock(return_value=["auth", "resumes"])
    mock_db.create_collection = AsyncMock()
    mock_client.__getitem__.return_value = mock_db

    with patch("scripts.check_db.AsyncIOMotorClient", return_value=mock_client):
        exit_code = await check_database()
        assert exit_code == 0

    captured = capsys.readouterr()
    assert "Ping result: 1.0 (OK" in captured.out
    assert "Collection 'auth': Confirmed exists." in captured.out
    mock_db.create_collection.assert_not_called()


@pytest.mark.asyncio
async def test_check_database_failure_prints_safe_hint(capsys: pytest.CaptureFixture) -> None:
    """Verify check_database outputs safe hint and exits non-zero on failure."""
    from pymongo.errors import ServerSelectionTimeoutError

    mock_client = MagicMock()
    mock_admin = MagicMock()
    mock_admin.command = AsyncMock(side_effect=ServerSelectionTimeoutError("Timeout"))
    mock_client.admin = mock_admin

    with patch("scripts.check_db.AsyncIOMotorClient", return_value=mock_client):
        exit_code = await check_database()
        assert exit_code == 1

    captured = capsys.readouterr()
    assert "ERROR: Failed to connect to MongoDB at host=cluster0.qmgryia.mongodb.net db=ai-mock-interview" in captured.err
    assert "Hint: Atlas unreachable. Check Network Access (IP allowlist) in Atlas and your internet connection." in captured.err
    assert "mongodb+srv://" not in captured.err
    assert "@" not in captured.err
