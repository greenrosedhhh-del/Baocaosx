import db as db_module


def test_init_schema_is_idempotent(client):
    db_module.init_schema()
    db_module.init_schema()

    conn = db_module.get_db()
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(shifts)")
    columns = {row[1] for row in cursor.fetchall()}
    conn.close()

    assert "created_by_user_id" in columns
    assert "updated_by_user_id" in columns
    assert "shift_leader" in columns


def test_users_table_exists(client):
    conn = db_module.get_db()
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(users)")
    columns = {row[1] for row in cursor.fetchall()}
    conn.close()

    assert {"id", "username", "password_hash", "full_name", "role", "active"}.issubset(columns)
