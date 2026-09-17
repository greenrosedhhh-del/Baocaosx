import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db_path = tmp_path / "test_vico.db"
    monkeypatch.setenv("VICO_DB_PATH", str(db_path))
    monkeypatch.setenv("ADMIN_BOOTSTRAP_USERNAME", "admin")
    monkeypatch.setenv("ADMIN_BOOTSTRAP_PASSWORD", "admin123")
    monkeypatch.setenv("SECRET_KEY", "test-secret")

    with TestClient(server.app) as c:
        yield c
