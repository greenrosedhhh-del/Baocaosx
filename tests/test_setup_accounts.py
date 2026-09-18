import importlib

import auth
import db


def _load_setup_module(tmp_path, monkeypatch):
    # Đặt DB tạm TRƯỚC khi import để script không bao giờ chạm vào DB thật
    monkeypatch.setenv("VICO_DB_PATH", str(tmp_path / "setup.db"))
    import setup_accounts
    return importlib.reload(setup_accounts)


def test_setup_creates_accounts_with_random_temp_passwords(tmp_path, monkeypatch):
    setup_accounts = _load_setup_module(tmp_path, monkeypatch)

    created = setup_accounts.setup()

    assert {"admin", "hai", "tan", "trong"} <= {username for username, _, _ in created}
    conn = db.get_db()
    for username, _, password in created:
        row = conn.execute(
            "SELECT password_hash, must_change_password FROM users WHERE username = ?", (username,)
        ).fetchone()
        assert password not in ("123456", "admin123")
        assert auth.verify_password(password, row["password_hash"])
        assert row["must_change_password"] == 1
    conn.close()


def test_setup_does_not_reset_existing_passwords(tmp_path, monkeypatch):
    setup_accounts = _load_setup_module(tmp_path, monkeypatch)
    setup_accounts.setup()

    conn = db.get_db()
    conn.execute(
        "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE username = 'hai'",
        (auth.hash_password("matkhaurieng"),),
    )
    conn.commit()
    conn.close()

    created = setup_accounts.setup()

    assert "hai" not in {username for username, _, _ in created}
    conn = db.get_db()
    row = conn.execute("SELECT password_hash, must_change_password FROM users WHERE username = 'hai'").fetchone()
    conn.close()
    assert auth.verify_password("matkhaurieng", row["password_hash"])
    assert row["must_change_password"] == 0


def test_migrated_leader_accounts_must_change_password(tmp_path, monkeypatch):
    import migrate_add_users

    monkeypatch.setenv("VICO_DB_PATH", str(tmp_path / "legacy.db"))
    db.init_schema()
    conn = db.get_db()
    conn.execute(
        "INSERT INTO shifts (report_date, shift_num, shift_leader, created_at) VALUES ('2026-09-10', 1, 'Tân', 'x')"
    )
    conn.commit()
    conn.close()

    migrate_add_users.migrate()

    conn = db.get_db()
    row = conn.execute("SELECT must_change_password FROM users WHERE full_name = 'Tân'").fetchone()
    conn.close()
    assert row["must_change_password"] == 1


def test_setup_does_not_crash_when_leader_is_named_admin(tmp_path, monkeypatch):
    setup_accounts = _load_setup_module(tmp_path, monkeypatch)
    db.init_schema()
    conn = db.get_db()
    conn.execute(
        "INSERT INTO users (username, password_hash, full_name, role, active, created_at, must_change_password) "
        "VALUES ('admin', ?, 'Ca trưởng tên admin', 'leader', 1, 'x', 0)",
        (auth.hash_password("leader123"),),
    )
    conn.commit()
    conn.close()

    created = setup_accounts.setup()

    conn = db.get_db()
    admins = [r["username"] for r in conn.execute("SELECT username FROM users WHERE role = 'admin'")]
    leader = conn.execute("SELECT role FROM users WHERE username = 'admin'").fetchone()
    conn.close()
    assert len(admins) == 1 and admins[0] != "admin"
    assert admins[0] in {username for username, _, _ in created}
    assert leader["role"] == "leader"
    # Chạy lại vẫn an toàn, không tạo thêm admin
    setup_accounts.setup()
    conn = db.get_db()
    assert conn.execute("SELECT COUNT(*) FROM users WHERE role = 'admin'").fetchone()[0] == 1
    conn.close()
