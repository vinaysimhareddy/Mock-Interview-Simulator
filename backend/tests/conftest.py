from typing import AsyncGenerator
import pytest
import pytest_asyncio

from app.core.config import get_settings
from app.core.database import mongo_manager, get_database

settings = get_settings()


@pytest.fixture(scope="session", autouse=True)
def enforce_test_environment() -> None:
    """Ensure test environment variables and test safety guards are active."""
    # Safety verification: MONGODB_TEST_DB_NAME must not equal production MONGODB_DB_NAME
    assert settings.MONGODB_TEST_DB_NAME != settings.MONGODB_DB_NAME, (
        f"Test configuration error: MONGODB_TEST_DB_NAME ({settings.MONGODB_TEST_DB_NAME}) "
        f"cannot match production MONGODB_DB_NAME ({settings.MONGODB_DB_NAME})."
    )


@pytest_asyncio.fixture(autouse=True)
async def clean_database_between_tests(request: pytest.FixtureRequest) -> AsyncGenerator[None, None]:
    """Isolate database state by cleaning test collections between test executions."""
    # Skip DB cleaning for pure unit/logic tests
    if (
        "test_face_policy" in request.node.nodeid
        or "test_safety_and_secrets" in request.node.nodeid
        or any(m.name == "unit" for m in request.node.iter_markers())
    ):
        yield
        return

    # Attempt connection and clean test collections safely
    try:
        db = await get_database()
        if db is not None:
            await mongo_manager.clean_test_database()
    except Exception as exc:
        # If remote Atlas DNS/network is temporarily unreachable, do not crash tests that mock or don't require DB
        pass

    yield

    try:
        db = await get_database()
        if db is not None:
            await mongo_manager.clean_test_database()
    except Exception:
        pass
