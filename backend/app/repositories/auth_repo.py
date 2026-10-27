from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Union
from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.core.config import AUTH_COLLECTION
from app.core.database import get_collection
from app.models.user import UserInDB


class DuplicateEmailError(Exception):
    """Raised when registration attempts to use an existing lowercased email address."""
    pass


class AuthRepository:
    """
    Data repository for the 'auth' collection in ai-mock-interview database.
    Single point of entry for reading and writing user accounts and credentials.
    """

    def __init__(self) -> None:
        pass

    @property
    def collection(self) -> Any:
        return get_collection(AUTH_COLLECTION)

    async def create_user(
        self,
        email: str,
        hashed_password: str,
        full_name: str,
        role: str = "candidate",
    ) -> UserInDB:
        """
        Create a new user account with normalized email, Argon2id hash, and default fields.
        Strictly catches DuplicateKeyError to handle duplicate email without check-then-insert.
        """
        normalized_email = email.strip().lower()
        now = datetime.now(timezone.utc)

        doc: Dict[str, Any] = {
            "email": normalized_email,
            "hashed_password": hashed_password,
            "full_name": full_name.strip(),
            "role": role if role in ("candidate", "admin") else "candidate",
            "is_active": True,
            "is_email_verified": False,
            "failed_login_count": 0,
            "locked_until": None,
            "last_login_at": None,
            "settings": {},
            "created_at": now,
            "updated_at": now,
        }

        try:
            result = await self.collection.insert_one(doc)
            user_id = str(result.inserted_id)
            doc["id"] = user_id
            return UserInDB(**doc)
        except DuplicateKeyError as e:
            raise DuplicateEmailError("A user with this email address already exists.") from e

    async def get_by_email(self, email: str) -> Optional[UserInDB]:
        """Fetch user by lowercased, trimmed email."""
        normalized_email = email.strip().lower()
        doc = await self.collection.find_one({"email": normalized_email})
        if not doc:
            return None
        return self._map_to_user(doc)

    async def get_by_id(self, user_id: Union[str, ObjectId]) -> Optional[UserInDB]:
        """Fetch user by ObjectId or string representation."""
        doc = None
        if isinstance(user_id, str):
            if ObjectId.is_valid(user_id):
                doc = await self.collection.find_one({"_id": ObjectId(user_id)})
            if not doc:
                doc = await self.collection.find_one({"_id": user_id})
            if not doc:
                doc = await self.collection.find_one({"id": user_id})
        else:
            doc = await self.collection.find_one({"_id": user_id})

        if not doc:
            return None
        return self._map_to_user(doc)

    async def record_failed_login(self, user: UserInDB) -> int:
        """
        Increment failed_login_count. Lock account for 15 minutes after 5 consecutive failures.
        Returns the new failed login count.
        """
        new_count = user.failed_login_count + 1
        now = datetime.now(timezone.utc)
        locked_until: Optional[datetime] = None

        if new_count >= 5:
            locked_until = now + timedelta(minutes=15)

        target_id: Union[ObjectId, str] = ObjectId(user.id) if ObjectId.is_valid(user.id) else user.id

        await self.collection.update_one(
            {"_id": target_id},
            {
                "$set": {
                    "failed_login_count": new_count,
                    "locked_until": locked_until,
                    "updated_at": now,
                }
            },
        )
        return new_count

    async def record_successful_login(self, user: UserInDB) -> None:
        """Reset failed login count and lockout timer, and record last_login_at timestamp."""
        now = datetime.now(timezone.utc)
        target_id: Union[ObjectId, str] = ObjectId(user.id) if ObjectId.is_valid(user.id) else user.id

        await self.collection.update_one(
            {"_id": target_id},
            {
                "$set": {
                    "failed_login_count": 0,
                    "locked_until": None,
                    "last_login_at": now,
                    "updated_at": now,
                }
            },
        )

    def is_locked(self, user: UserInDB) -> bool:
        """Check if user account is currently locked out."""
        if user.locked_until is None:
            return False
        now = datetime.now(timezone.utc)
        return user.locked_until > now

    def _map_to_user(self, doc: Dict[str, Any]) -> UserInDB:
        """Helper to ensure ObjectId is converted to string id and datetimes are timezone-aware."""
        data = dict(doc)
        if "_id" in data:
            data["id"] = str(data["_id"])
        if "created_at" in data and isinstance(data["created_at"], datetime) and data["created_at"].tzinfo is None:
            data["created_at"] = data["created_at"].replace(tzinfo=timezone.utc)
        if "updated_at" in data and isinstance(data["updated_at"], datetime) and data["updated_at"].tzinfo is None:
            data["updated_at"] = data["updated_at"].replace(tzinfo=timezone.utc)
        if "locked_until" in data and isinstance(data["locked_until"], datetime) and data["locked_until"].tzinfo is None:
            data["locked_until"] = data["locked_until"].replace(tzinfo=timezone.utc)
        if "last_login_at" in data and isinstance(data["last_login_at"], datetime) and data["last_login_at"].tzinfo is None:
            data["last_login_at"] = data["last_login_at"].replace(tzinfo=timezone.utc)
        return UserInDB(**data)


auth_repo = AuthRepository()
