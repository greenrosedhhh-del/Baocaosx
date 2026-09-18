"""#10: admin xóa báo cáo ca nộp nhầm; #13: mẫu ca trước không lộ ghi chú của ca trưởng khác."""
import db
from helpers import create_active_user, login, login_admin

DAY = "2026-09-16"
FULL_SHIFT = {
    "report_date": DAY, "shift_num": 2,
    "packaging": [{"product_name": "D25", "customer": "VICO", "weight_sorted": 100, "notes": "Ghi chú riêng của Tân"}],
    "baskets": [{"product_name": "D25", "customer": "VICO", "steel_grade": "CR18", "basket_count": 2, "notes": "bí mật"}],
    "tumbling": [{"product_name": "D25", "customer": "VICO", "m1": 1, "total_weight": 50, "notes": "Khô dầu riêng"}],
}


def _count(table, where="", params=()):
    conn = db.get_db()
    value = conn.execute(f"SELECT COUNT(*) FROM {table} {where}", params).fetchone()[0]
    conn.close()
    return value


def test_admin_can_delete_shift_and_its_items(client):
    create_active_user(client, "tan", "Tân")
    login(client, "tan", "leader123")
    assert client.post("/api/shifts", json=FULL_SHIFT).status_code == 200
    assert client.post("/api/shifts", json=dict(FULL_SHIFT, shift_num=1)).status_code == 200

    login_admin(client)
    resp = client.delete("/api/shifts", params={"date": DAY, "shift_num": 2})
    assert resp.status_code == 200

    remaining = client.get("/api/shifts", params={"date": DAY}).json()
    assert [s["shift_num"] for s in remaining] == [1]
    assert _count("packaging_items") == 1
    assert _count("basket_items") == 1
    assert _count("tumbling_items") == 1
    assert client.get("/api/shifts/check-status", params={"date": DAY, "shift_num": 2}).json()["exists"] is False


def test_real_owner_can_submit_after_admin_deletes_wrong_slot(client):
    create_active_user(client, "tan", "Tân")
    create_active_user(client, "hai", "Hải")
    login(client, "tan", "leader123")
    assert client.post("/api/shifts", json=FULL_SHIFT).status_code == 200
    login(client, "hai", "leader123")
    assert client.post("/api/shifts", json=FULL_SHIFT).status_code == 403

    login_admin(client)
    assert client.delete("/api/shifts", params={"date": DAY, "shift_num": 2}).status_code == 200

    login(client, "hai", "leader123")
    assert client.post("/api/shifts", json=dict(FULL_SHIFT, expected_mode="create")).status_code == 200


def test_delete_missing_shift_returns_404(client):
    login_admin(client)
    assert client.delete("/api/shifts", params={"date": DAY, "shift_num": 3}).status_code == 404


def test_leader_cannot_delete_shift(client):
    create_active_user(client, "tan", "Tân")
    login(client, "tan", "leader123")
    assert client.post("/api/shifts", json=FULL_SHIFT).status_code == 200
    assert client.delete("/api/shifts", params={"date": DAY, "shift_num": 2}).status_code == 403
    assert _count("shifts") == 1


def test_delete_requires_login_and_valid_params(client):
    assert client.delete("/api/shifts", params={"date": DAY, "shift_num": 2}).status_code == 401
    login_admin(client)
    assert client.delete("/api/shifts", params={"date": "2026-9-16", "shift_num": 2}).status_code == 400
    assert client.delete("/api/shifts", params={"date": DAY, "shift_num": 4}).status_code == 422


# ---------- #13 ----------

def test_previous_template_returns_only_product_customer_and_grade(client):
    create_active_user(client, "tan", "Tân")
    login(client, "tan", "leader123")
    assert client.post("/api/shifts", json=FULL_SHIFT).status_code == 200

    create_active_user(client, "hai", "Hải")
    login(client, "hai", "leader123")
    data = client.get("/api/shifts/previous-template").json()
    assert data["found"] is True
    assert data["packaging"] == [{"product_name": "D25", "customer": "VICO"}]
    assert data["baskets"] == [{"product_name": "D25", "customer": "VICO", "steel_grade": "CR18"}]
    assert data["tumbling"] == [{"product_name": "D25", "customer": "VICO"}]
    assert "bí mật" not in str(data) and "riêng" not in str(data)
