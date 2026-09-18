import db
from helpers import create_active_user, login, login_admin

BASE_SHIFT = {"report_date": "2026-09-17", "shift_num": 1, "issues": "", "suggestions": ""}


def _get_shift(client, report_date="2026-09-17", shift_num=1):
    login_admin(client)
    shifts = client.get("/api/shifts", params={"date": report_date}).json()
    return next(s for s in shifts if s["shift_num"] == shift_num)


# ---------- Admin sửa báo cáo không đổi người nộp ----------

def test_admin_edit_keeps_original_shift_leader_and_submit_time(client):
    create_active_user(client, "hai", "Hải")
    login(client, "hai", "leader123")
    assert client.post("/api/shifts", json=BASE_SHIFT).status_code == 200
    original = _get_shift(client)

    resp = client.post("/api/shifts", json=dict(BASE_SHIFT, suggestions="Admin bổ sung"))
    assert resp.status_code == 200

    edited = _get_shift(client)
    assert edited["shift_leader"] == "Hải"
    assert edited["created_at"] == original["created_at"]
    assert edited["suggestions"] == "Admin bổ sung"
    assert edited["updated_at"] is not None


# ---------- Báo cáo cũ chưa gán chủ ----------

def _insert_legacy_shift():
    conn = db.get_db()
    conn.execute(
        "INSERT INTO shifts (report_date, shift_num, shift_leader, created_at) VALUES (?, ?, ?, ?)",
        ("2026-09-17", 1, "Người cũ", "2026-09-17 08:00:00"),
    )
    conn.commit()
    conn.close()


def test_leader_cannot_overwrite_legacy_shift_without_owner(client):
    create_active_user(client, "hai", "Hải")
    _insert_legacy_shift()
    login(client, "hai", "leader123")
    assert client.post("/api/shifts", json=BASE_SHIFT).status_code == 403


def test_admin_can_edit_legacy_shift_without_owner(client):
    _insert_legacy_shift()
    login_admin(client)
    assert client.post("/api/shifts", json=BASE_SHIFT).status_code == 200
    assert _get_shift(client)["shift_leader"] == "Người cũ"


# ---------- Không lưu dòng trống ----------

def test_rows_without_numbers_or_notes_are_not_saved(client):
    login_admin(client)
    payload = dict(
        BASE_SHIFT,
        packaging=[
            {"product_name": "D25", "customer": "Molycop", "weight_sorted": 0, "weight_waste": 0, "notes": ""},
            {"product_name": "D40", "customer": "VICO", "weight_sorted": 500, "weight_waste": 5, "notes": ""},
            {"product_name": "D60", "customer": "VICO", "weight_sorted": 0, "weight_waste": 0, "notes": "Xếp kho chờ nghiệm thu"},
        ],
        baskets=[{"product_name": "D25", "customer": "Molycop", "steel_grade": "CR18", "basket_count": 0, "total_weight": None, "notes": ""}],
        tumbling=[{"product_name": "D25", "customer": "Molycop", "m1": 0, "m2": 0, "total_weight": 0, "notes": "  "}],
    )
    assert client.post("/api/shifts", json=payload).status_code == 200

    shift = _get_shift(client)
    assert [p["product_name"] for p in shift["packaging"]] == ["D40", "D60"]
    assert shift["baskets"] == []
    assert shift["tumbling"] == []


# ---------- Kiểm tra dữ liệu đầu vào ----------

def test_invalid_shift_number_is_rejected(client):
    login_admin(client)
    resp = client.post("/api/shifts", json=dict(BASE_SHIFT, shift_num=9))
    assert resp.status_code == 422
    assert isinstance(resp.json()["detail"], str)


def test_invalid_report_date_is_rejected(client):
    login_admin(client)
    assert client.post("/api/shifts", json=dict(BASE_SHIFT, report_date="abc")).status_code == 422
    assert client.post("/api/shifts", json=dict(BASE_SHIFT, report_date="2026-02-30")).status_code == 422


def test_negative_weight_is_rejected(client):
    login_admin(client)
    payload = dict(BASE_SHIFT, packaging=[
        {"product_name": "D25", "customer": "VICO", "weight_sorted": -100, "weight_waste": 0, "notes": ""}
    ])
    assert client.post("/api/shifts", json=payload).status_code == 422


def test_invalid_date_query_returns_400(client):
    login_admin(client)
    assert client.get("/api/daily-summary", params={"date": "abc"}).status_code == 400
    assert client.get("/api/export-excel", params={"date": "2026-13-01"}).status_code == 400


def test_daily_summary_reports_excel_row_limits(client):
    login_admin(client)
    data = client.get("/api/daily-summary", params={"date": "2026-09-17"}).json()
    assert data["excel_row_limits"] == {"packaging": 4, "baskets": 4, "tumbling": 6}


# ---------- Admin tự khóa mình ----------

def test_admin_cannot_deactivate_own_account(client):
    login_admin(client)
    me_id = next(u["id"] for u in client.get("/api/admin/users").json() if u["username"] == "admin")
    resp = client.patch(f"/api/admin/users/{me_id}", json={"active": False})
    assert resp.status_code == 400
    assert client.get("/api/auth/me").status_code == 200
