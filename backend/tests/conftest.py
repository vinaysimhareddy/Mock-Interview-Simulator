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
async def clean_database_between_tests() -> AsyncGenerator[None, None]:
    """Isolate database state by cleaning test collections between test executions."""
    # Connect and clean test collections
    db = await get_database()
    assert db is not None
    await mongo_manager.clean_test_database()
    yield
    await mongo_manager.clean_test_database()
