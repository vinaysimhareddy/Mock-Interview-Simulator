from pathlib import Path
import subprocess
import sys

# Forward execution to backend/scripts/verify_auth_storage.py with backend python environment
ROOT_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = ROOT_DIR / "backend"
TARGET_SCRIPT = BACKEND_DIR / "scripts" / "verify_auth_storage.py"

VENV_PYTHON = BACKEND_DIR / ".venv" / "Scripts" / "python.exe"
if not VENV_PYTHON.exists():
    VENV_PYTHON = Path(sys.executable)

env = dict(sys.path and sys.modules and "")
result = subprocess.run(
    [str(VENV_PYTHON), str(TARGET_SCRIPT)],
    cwd=str(BACKEND_DIR),
)
sys.exit(result.returncode)
