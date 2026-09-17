"""Database connection and schema management for the VICO reporting system."""
import os
import sqlite3

DEFAULT_DB_PATH = os.path.join(os.path.dirname(__file__), "vico_production.db")


def get_db_path() -> str:
    return os.environ.get("VICO_DB_PATH", DEFAULT_DB_PATH)


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    return conn


def _table_has_column(cursor: sqlite3.Cursor, table: str, column: str) -> bool:
    cursor.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cursor.fetchall())


def init_schema() -> None:
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_date TEXT NOT NULL,
        shift_num INTEGER NOT NULL,
        shift_leader TEXT NOT NULL,
        safety_ppe INTEGER DEFAULT 1,
        safety_equip INTEGER DEFAULT 1,
        staff_total INTEGER DEFAULT 5,
        staff_present INTEGER DEFAULT 5,
        leave_permitted INTEGER DEFAULT 0,
        leave_permitted_names TEXT,
        leave_unpermitted INTEGER DEFAULT 0,
        leave_unpermitted_names TEXT,
        issues TEXT,
        suggestions TEXT,
        start_time TEXT,
        end_time TEXT,
        created_at TEXT,
        UNIQUE(report_date, shift_num)
    )
    """)
    if not _table_has_column(cursor, "shifts", "created_by_user_id"):
        cursor.execute("ALTER TABLE shifts ADD COLUMN created_by_user_id INTEGER")
    if not _table_has_column(cursor, "shifts", "updated_by_user_id"):
        cursor.execute("ALTER TABLE shifts ADD COLUMN updated_by_user_id INTEGER")

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS packaging_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shift_id INTEGER NOT NULL,
        product_name TEXT,
        customer TEXT,
        from_val TEXT,
        to_val TEXT,
        weight_sorted REAL,
        weight_waste REAL,
        notes TEXT,
        FOREIGN KEY(shift_id) REFERENCES shifts(id) ON DELETE CASCADE
    )
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS basket_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shift_id INTEGER NOT NULL,
        product_name TEXT,
        customer TEXT,
        from_val TEXT,
        to_val TEXT,
        steel_grade TEXT,
        basket_count REAL,
        total_weight REAL,
        notes TEXT,
        FOREIGN KEY(shift_id) REFERENCES shifts(id) ON DELETE CASCADE
    )
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS tumbling_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shift_id INTEGER NOT NULL,
        product_name TEXT,
        customer TEXT,
        m1 REAL,
        m2 REAL,
        total_weight REAL,
        notes TEXT,
        FOREIGN KEY(shift_id) REFERENCES shifts(id) ON DELETE CASCADE
    )
    """)

    conn.commit()
    conn.close()
