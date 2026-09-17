import db
import migrate_add_users


def _insert_legacy_shift(conn, report_date, shift_num, shift_leader):
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO shifts (report_date, shift_num, shift_leader, created_at)
        VALUES (?, ?, ?, ?)
    """, (report_date, shift_num, shift_leader, "2026-09-10 08:00:00"))
    conn.commit()


def test_migrate_creates_leader_accounts_and_backfills_ownership(tmp_path, monkeypatch):
    db_path = tmp_path / "legacy.db"
    monkeypatch.setenv("VICO_DB_PATH", str(db_path))
    db.init_schema()

    conn = db.get_db()
    _insert_legacy_shift(conn, "2026-09-10", 1, "Tân")
    _insert_legacy_shift(conn, "2026-09-10", 2, "Hải")
    conn.close()

    migrate_add_users.migrate()

    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, role FROM users WHERE full_name = 'Tân'")
    tan_user = cursor.fetchone()
    assert tan_user is not None
    assert tan_user["role"] == "leader"

    cursor.execute("SELECT created_by_user_id FROM shifts WHERE shift_leader = 'Tân'")
    assert cursor.fetchone()["created_by_user_id"] == tan_user["id"]
    conn.close()


def test_migrate_is_idempotent(tmp_path, monkeypatch):
    db_path = tmp_path / "legacy2.db"
    monkeypatch.setenv("VICO_DB_PATH", str(db_path))
    db.init_schema()

    conn = db.get_db()
    _insert_legacy_shift(conn, "2026-09-11", 1, "Quang")
    conn.close()

    migrate_add_users.migrate()
    migrate_add_users.migrate()

    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) as c FROM users WHERE full_name = 'Quang'")
    assert cursor.fetchone()["c"] == 1
    conn.close()
