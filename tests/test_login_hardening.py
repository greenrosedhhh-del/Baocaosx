"""Đăng nhập: chống DoS bộ nhớ (#1), không lộ tên đăng nhập qua thời gian phản hồi (#6),
ẩn tài liệu API (#7), kiểm tra ADMIN_BOOTSTRAP_PASSWORD (#8)."""
import sqlite3
import time

from fastapi.testclient import TestClient

import auth
import server


# ---------- #1: giới hạn độ dài & bộ đếm đăng nhập sai có giới hạn ----------

def test_login_rejects_overlong_username_with_422(client):
    resp = client.post("/api/auth/login", json={"username": "a" * 65, "password": "whatever1"})
    assert resp.status_code == 422


def test_login_rejects_huge_username_and_password_with_422(client):
    huge = "x" * (3 * 1024 * 1024)
    assert client.post("/api/auth/login", json={"username": huge, "password": "abc"}).status_code == 422
    assert client.post("/api/auth/login", json={"username": "admin", "password": huge}).status_code == 422


def test_login_rejects_password_longer_than_128_chars(client):
    resp = client.post("/api/auth/login", json={"username": "admin", "password": "a" * 129})
    assert resp.status_code == 422


def test_rejected_long_username_is_not_tracked_by_throttle(client):
    for i in range(3):
        client.post("/api/auth/login", json={"username": f"{i}" + "u" * 100, "password": "x"})
    assert auth.login_throttle.stats()["failure_keys"] == 0


def test_login_throttle_hard_caps_tracked_keys():
    now = [1000.0]
    throttle = auth.LoginThrottle(max_failures=5, window_seconds=900, lockout_seconds=300,
                                  clock=lambda: now[0], max_keys=50)
    for i in range(2000):
        throttle.record_failure(f"user{i}")
        now[0] += 0.001
    stats = throttle.stats()
    assert stats["failure_keys"] <= 50
    assert stats["locked_keys"] <= 50


def test_login_throttle_caps_locked_keys_too():
    now = [1000.0]
    throttle = auth.LoginThrottle(max_failures=1, window_seconds=900, lockout_seconds=300,
                                  clock=lambda: now[0], max_keys=20)
    for i in range(500):
        throttle.record_failure(f"user{i}")
    assert throttle.stats()["locked_keys"] <= 20
    # Khóa mới nhất vẫn còn hiệu lực
    assert throttle.seconds_locked("user499") > 0


def test_login_throttle_prunes_expired_locks():
    now = [1000.0]
    throttle = auth.LoginThrottle(max_failures=1, window_seconds=60, lockout_seconds=30,
                                  clock=lambda: now[0], max_keys=10)
    for i in range(10):
        throttle.record_failure(f"user{i}")
    assert throttle.stats()["locked_keys"] == 10

    now[0] += 3600
    throttle.record_failure("newcomer1")
    stats = throttle.stats()
    assert stats["locked_keys"] == 1  # chỉ còn khóa của newcomer1
    assert throttle.seconds_locked("newcomer1") > 0


def test_login_throttle_does_not_keep_empty_failure_lists_after_lock():
    now = [1000.0]
    throttle = auth.LoginThrottle(max_failures=2, window_seconds=60, lockout_seconds=30, clock=lambda: now[0])
    throttle.record_failure("admin")
    throttle.record_failure("admin")
    assert throttle.stats() == {"failure_keys": 0, "locked_keys": 1}


def test_lockout_semantics_unchanged_for_case_and_spaces(client):
    for _ in range(5):
        assert client.post("/api/auth/login", json={"username": " Admin ", "password": "wrong"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": "admin", "password": "admin123"}).status_code == 429


# ---------- #6: thời gian phản hồi không lộ tài khoản tồn tại ----------

def test_login_runs_bcrypt_for_missing_user(client, monkeypatch):
    calls = []
    real_verify = auth.verify_password

    def spy(password, password_hash):
        calls.append(password_hash)
        return real_verify(password, password_hash)

    monkeypatch.setattr(auth, "verify_password", spy)
    resp = client.post("/api/auth/login", json={"username": "khongtontai", "password": "abc123"})
    assert resp.status_code == 401
    assert len(calls) == 1


def test_login_runs_bcrypt_for_inactive_user(client, monkeypatch):
    client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    user_id = client.post("/api/admin/users", json={
        "username": "khoa", "full_name": "Khóa", "password": "tam12345", "role": "leader"
    }).json()["id"]
    assert client.patch(f"/api/admin/users/{user_id}", json={"active": False}).status_code == 200

    calls = []
    real_verify = auth.verify_password

    def spy(password, password_hash):
        calls.append(password_hash)
        return real_verify(password, password_hash)

    monkeypatch.setattr(auth, "verify_password", spy)
    resp = client.post("/api/auth/login", json={"username": "khoa", "password": "tam12345"})
    assert resp.status_code == 401
    assert len(calls) == 1


def test_login_timing_similar_for_missing_and_existing_user(client):
    def timed(username):
        best = None
        for _ in range(2):
            start = time.perf_counter()
            client.post("/api/auth/login", json={"username": username, "password": "sai-mat-khau"})
            elapsed = time.perf_counter() - start
            best = elapsed if best is None else min(best, elapsed)
        return best

    existing = timed("admin")
    missing = timed("nguoila")
    assert missing >= existing * 0.3, (missing, existing)


# ---------- #7: tài liệu API ẩn mặc định ----------

def test_api_docs_are_disabled_by_default(client):
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404, path


def test_api_docs_settings_follow_env(monkeypatch):
    monkeypatch.delenv("ENABLE_API_DOCS", raising=False)
    assert server.api_docs_settings() == {"docs_url": None, "redoc_url": None, "openapi_url": None}
    monkeypatch.setenv("ENABLE_API_DOCS", "1")
    assert server.api_docs_settings() == {}


# ---------- #8: ADMIN_BOOTSTRAP_PASSWORD không hợp lệ ----------

def _bootstrap_with_password(tmp_path, monkeypatch, password):
    db_file = tmp_path / "boot.db"
    monkeypatch.setenv("VICO_DB_PATH", str(db_file))
    monkeypatch.setenv("ADMIN_BOOTSTRAP_USERNAME", "admin")
    monkeypatch.setenv("ADMIN_BOOTSTRAP_PASSWORD", password)
    with TestClient(server.app) as c:
        status = c.post("/api/auth/login", json={"username": "admin", "password": password[:128]}).status_code
    conn = sqlite3.connect(str(db_file))
    row = conn.execute("SELECT must_change_password FROM users WHERE role = 'admin'").fetchone()
    conn.close()
    return status, row[0]


def test_too_short_bootstrap_password_is_replaced_by_forced_temp_password(tmp_path, monkeypatch, capfd):
    status, must_change = _bootstrap_with_password(tmp_path, monkeypatch, "a")
    assert status in (401, 422)
    assert must_change == 1
    out = capfd.readouterr().out
    assert "ADMIN_BOOTSTRAP_PASSWORD" in out
    assert out.isascii()


def test_overlong_bootstrap_password_does_not_crash_startup(tmp_path, monkeypatch, capfd):
    status, must_change = _bootstrap_with_password(tmp_path, monkeypatch, "x" * 73)
    assert status in (401, 422)
    assert must_change == 1
    assert capfd.readouterr().out.isascii()


def test_bootstrap_does_not_crash_when_admin_username_taken_by_leader(tmp_path, monkeypatch):
    db_file = tmp_path / "taken.db"
    monkeypatch.setenv("VICO_DB_PATH", str(db_file))
    monkeypatch.setenv("ADMIN_BOOTSTRAP_USERNAME", "admin")
    monkeypatch.setenv("ADMIN_BOOTSTRAP_PASSWORD", "admin123")
    import db
    db.init_schema()
    conn = db.get_db()
    conn.execute("INSERT INTO users (username, password_hash, full_name, role, active, created_at, must_change_password) "
                 "VALUES ('admin', ?, 'Leader tên admin', 'leader', 1, 'x', 0)", (auth.hash_password("leader123"),))
    conn.commit()
    conn.close()

    with TestClient(server.app):
        pass

    conn = sqlite3.connect(str(db_file))
    admins = conn.execute("SELECT username FROM users WHERE role = 'admin'").fetchall()
    conn.close()
    assert len(admins) == 1
    assert admins[0][0] != "admin"
