"""Kiểm tra dữ liệu đầu vào: số vô hạn/quá lớn (#2), ngày không chuẩn / tương lai (#3),
ràng buộc chéo chấm công (#9), ký tự điều khiển & độ dài (#12), expected_mode (#14)."""
import json
from datetime import date, timedelta

import db
import server
from helpers import create_active_user, login, login_admin

DAY = "2026-09-17"
BASE = {"report_date": DAY, "shift_num": 1}


def _post_raw(client, raw_json):
    return client.post("/api/shifts", content=raw_json, headers={"Content-Type": "application/json"})


def _all_read_endpoints_ok(client, report_date=DAY):
    assert client.get("/api/shifts/check-status", params={"date": report_date, "shift_num": 1}).status_code == 200
    assert client.get("/api/shifts", params={"date": report_date}).status_code == 200
    assert client.get("/api/daily-summary", params={"date": report_date}).status_code == 200


# ---------- #2: số ----------

def test_infinity_and_nan_literals_are_rejected(client):
    login_admin(client)
    for literal in ("Infinity", "-Infinity", "NaN", "1e309"):
        raw = ('{"report_date": "%s", "shift_num": 1, "packaging": [{"product_name": "D25", "customer": "VICO", '
               '"weight_sorted": %s, "weight_waste": 0}]}') % (DAY, literal)
        assert _post_raw(client, raw).status_code == 422, literal
    _all_read_endpoints_ok(client)


def test_infinite_values_in_baskets_and_tumbling_are_rejected(client):
    login_admin(client)
    raw_b = ('{"report_date": "%s", "shift_num": 1, "baskets": [{"product_name": "D25", "customer": "VICO", '
             '"basket_count": 1e309, "total_weight": null}]}') % DAY
    raw_t = ('{"report_date": "%s", "shift_num": 1, "tumbling": [{"product_name": "D25", "customer": "VICO", '
             '"m1": Infinity, "m2": 0, "total_weight": 0}]}') % DAY
    assert _post_raw(client, raw_b).status_code == 422
    assert _post_raw(client, raw_t).status_code == 422
    _all_read_endpoints_ok(client)


def test_huge_finite_numbers_are_rejected_and_date_stays_readable(client):
    login_admin(client)
    huge = dict(BASE, packaging=[{"product_name": "D25", "customer": "VICO", "weight_sorted": 1e308, "weight_waste": 0}])
    assert client.post("/api/shifts", json=huge).status_code == 422
    baskets = dict(BASE, baskets=[{"product_name": "D25", "customer": "VICO", "basket_count": 1e300}])
    assert client.post("/api/shifts", json=baskets).status_code == 422
    _all_read_endpoints_ok(client)


def test_reasonable_upper_bounds_are_accepted(client):
    login_admin(client)
    payload = dict(
        BASE,
        staff_total=1000, staff_present=1000,
        packaging=[{"product_name": "D25", "customer": "VICO", "weight_sorted": 10_000_000, "weight_waste": 10_000_000}],
        baskets=[{"product_name": "D25", "customer": "VICO", "basket_count": 100_000, "total_weight": 10_000_000}],
        tumbling=[{"product_name": "D25", "customer": "VICO", "m1": 100_000, "m2": 100_000, "total_weight": 10_000_000}],
    )
    assert client.post("/api/shifts", json=payload).status_code == 200
    _all_read_endpoints_ok(client)


def test_just_above_bounds_are_rejected(client):
    login_admin(client)
    cases = [
        dict(BASE, packaging=[{"product_name": "D25", "customer": "VICO", "weight_sorted": 10_000_001}]),
        dict(BASE, baskets=[{"product_name": "D25", "customer": "VICO", "basket_count": 100_001}]),
        dict(BASE, tumbling=[{"product_name": "D25", "customer": "VICO", "m1": 100_001}]),
        dict(BASE, staff_total=1001, staff_present=5),
    ]
    for payload in cases:
        assert client.post("/api/shifts", json=payload).status_code == 422, payload


def test_huge_integer_staff_total_is_422_not_500(client):
    login_admin(client)
    raw = '{"report_date": "%s", "shift_num": 1, "staff_total": %d, "staff_present": 5}' % (DAY, 10 ** 30)
    resp = _post_raw(client, raw)
    assert resp.status_code == 422
    _all_read_endpoints_ok(client)


def test_patch_user_with_huge_id_is_not_500(client):
    login_admin(client)
    resp = client.patch(f"/api/admin/users/{10 ** 30}", json={"active": True})
    assert resp.status_code in (404, 422)


def test_unexpected_error_does_not_leak_exception_text(client, monkeypatch):
    login_admin(client)

    def boom():
        raise RuntimeError("chi-tiet-noi-bo-bi-mat")

    monkeypatch.setattr(server, "now_str", boom)
    resp = client.post("/api/shifts", json=BASE)
    assert resp.status_code == 500
    assert "chi-tiet-noi-bo-bi-mat" not in resp.text
    assert isinstance(resp.json()["detail"], str) and resp.json()["detail"]


# ---------- #3: ngày ----------

NON_CANONICAL_DATES = ["2026-9-17", "2026-09- 7", "２０２６-０９-１７", " 2026-09-17", "2026-09-17 ", "20260917"]


def test_non_canonical_report_dates_are_rejected(client):
    login_admin(client)
    for bad in NON_CANONICAL_DATES:
        assert client.post("/api/shifts", json=dict(BASE, report_date=bad)).status_code == 422, bad


def test_non_canonical_query_dates_are_rejected(client):
    login_admin(client)
    for bad in NON_CANONICAL_DATES:
        assert client.get("/api/shifts", params={"date": bad}).status_code == 400, bad
        assert client.get("/api/shifts/check-status", params={"date": bad, "shift_num": 1}).status_code == 400, bad
        assert client.get("/api/daily-summary", params={"date": bad}).status_code == 400, bad


def test_non_canonical_date_cannot_create_duplicate_shift(client):
    login_admin(client)
    assert client.post("/api/shifts", json=dict(BASE, report_date="2026-09-07")).status_code == 200
    assert client.post("/api/shifts", json=dict(BASE, report_date="2026-9-7")).status_code == 422
    conn = db.get_db()
    count = conn.execute("SELECT COUNT(*) FROM shifts WHERE shift_num = 1").fetchone()[0]
    conn.close()
    assert count == 1


def test_report_date_more_than_one_day_in_future_is_rejected(client):
    login_admin(client)
    today = date.today()
    tomorrow = (today + timedelta(days=1)).isoformat()
    too_far = (today + timedelta(days=2)).isoformat()
    assert client.post("/api/shifts", json=dict(BASE, report_date=tomorrow)).status_code == 200
    resp = client.post("/api/shifts", json=dict(BASE, report_date=too_far))
    assert resp.status_code == 422
    assert "Value error" not in resp.json()["detail"]


# ---------- #9: ràng buộc chấm công ----------

def test_staff_present_greater_than_total_is_rejected(client):
    login_admin(client)
    resp = client.post("/api/shifts", json=dict(BASE, staff_total=5, staff_present=7))
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert "có mặt" in detail.lower()
    assert "Value error" not in detail


def test_leave_counts_greater_than_total_are_rejected(client):
    login_admin(client)
    resp = client.post("/api/shifts", json=dict(BASE, staff_total=5, staff_present=2, leave_permitted=3, leave_unpermitted=3))
    assert resp.status_code == 422
    assert "nghỉ" in resp.json()["detail"].lower()
    assert client.post("/api/shifts", json=dict(BASE, staff_total=5, staff_present=5, leave_permitted=6)).status_code == 422
    assert client.post("/api/shifts", json=dict(BASE, staff_total=5, staff_present=5, leave_rotating=6)).status_code == 422
    assert client.post("/api/shifts", json=dict(BASE, staff_total=5, staff_present=1, leave_permitted=2, leave_rotating=2, leave_unpermitted=2)).status_code == 422


def test_consistent_attendance_is_accepted(client):
    login_admin(client)
    payload = dict(BASE, staff_total=6, staff_present=3, leave_permitted=1, leave_rotating=1, leave_unpermitted=1)
    assert client.post("/api/shifts", json=payload).status_code == 200


# ---------- #12: ký tự điều khiển & độ dài ----------

def test_control_characters_are_stripped_from_text_fields(client):
    login_admin(client)
    payload = dict(
        BASE,
        issues="Dòng 1\x00\x07\n\tDòng 2\x1b",
        suggestions="Đề\x0bxuất\x7f",
        leave_permitted_names="Hợi\x01",
        leave_rotating_names="Đồng\x05",
        start_time="6h\x08",
        packaging=[{"product_name": "D2\x005", "customer": "VI\x1fCO", "weight_sorted": 10, "notes": "ghi\x0cchú\r\nok"}],
        baskets=[{"product_name": "D25", "customer": "VICO", "steel_grade": "CR\x1818", "basket_count": 1}],
        tumbling=[{"product_name": "D25", "customer": "VICO", "m1": 1, "notes": "\x02Khô dầu"}],
    )
    assert client.post("/api/shifts", json=payload).status_code == 200
    shift = client.get("/api/shifts", params={"date": DAY}).json()[0]
    assert shift["issues"] == "Dòng 1\n\tDòng 2"
    assert shift["suggestions"] == "Đềxuất"
    assert shift["leave_permitted_names"] == "Hợi"
    assert shift["leave_rotating_names"] == "Đồng"
    assert shift["start_time"] == "6h"
    assert shift["packaging"][0]["product_name"] == "D25"
    assert shift["packaging"][0]["customer"] == "VICO"
    assert shift["packaging"][0]["notes"] == "ghichú\r\nok"
    assert shift["baskets"][0]["steel_grade"] == "CR18"
    assert shift["tumbling"][0]["notes"] == "Khô dầu"


def test_lone_surrogates_do_not_cause_500(client):
    login_admin(client)
    raw = '{"report_date": "%s", "shift_num": 1, "issues": "abc\\ud800def"}' % DAY
    resp = _post_raw(client, raw)
    assert resp.status_code == 200
    assert client.get("/api/shifts", params={"date": DAY}).json()[0]["issues"] == "abcdef"


def test_text_field_length_limits(client):
    login_admin(client)
    ok = dict(BASE, issues="a" * 2000, suggestions="b" * 2000,
              packaging=[{"product_name": "p" * 100, "customer": "c" * 100, "weight_sorted": 1, "notes": "n" * 2000}])
    assert client.post("/api/shifts", json=ok).status_code == 200

    too_long = [
        dict(BASE, issues="a" * 2001),
        dict(BASE, suggestions="a" * 2001),
        dict(BASE, packaging=[{"product_name": "p" * 101, "customer": "VICO", "weight_sorted": 1}]),
        dict(BASE, baskets=[{"product_name": "D25", "customer": "c" * 101, "basket_count": 1}]),
        dict(BASE, tumbling=[{"product_name": "D25", "customer": "VICO", "m1": 1, "notes": "n" * 2001}]),
        dict(BASE, leave_permitted_names="x" * 501),
    ]
    for payload in too_long:
        assert client.post("/api/shifts", json=payload).status_code == 422


def test_user_names_are_cleaned_and_limited(client):
    login_admin(client)
    resp = client.post("/api/admin/users", json={
        "username": "moi\x00", "full_name": "Người\x07 Mới", "password": "tam12345", "role": "leader"
    })
    assert resp.status_code == 200
    user = next(u for u in client.get("/api/admin/users").json() if u["id"] == resp.json()["id"])
    assert user["username"] == "moi"
    assert user["full_name"] == "Người Mới"

    assert client.post("/api/admin/users", json={
        "username": "u" * 65, "full_name": "X", "password": "tam12345", "role": "leader"
    }).status_code == 422
    assert client.post("/api/admin/users", json={
        "username": "okname", "full_name": "F" * 101, "password": "tam12345", "role": "leader"
    }).status_code == 422


# ---------- #14: expected_mode ----------

def test_expected_mode_create_conflicts_when_report_exists(client):
    login_admin(client)
    assert client.post("/api/shifts", json=dict(BASE, expected_mode="create")).status_code == 200
    resp = client.post("/api/shifts", json=dict(BASE, expected_mode="create", issues="ghi đè"))
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Ca này đã có báo cáo. Vui lòng kiểm tra lại trước khi lưu."
    assert client.get("/api/shifts", params={"date": DAY}).json()[0]["issues"] == ""


def test_expected_mode_update_conflicts_when_report_missing(client):
    login_admin(client)
    resp = client.post("/api/shifts", json=dict(BASE, expected_mode="update"))
    assert resp.status_code == 409
    assert client.get("/api/shifts", params={"date": DAY}).json() == []


def test_expected_mode_update_saves_existing_report(client):
    login_admin(client)
    assert client.post("/api/shifts", json=dict(BASE, expected_mode="create")).status_code == 200
    assert client.post("/api/shifts", json=dict(BASE, expected_mode="update", issues="sửa")).status_code == 200
    assert client.get("/api/shifts", params={"date": DAY}).json()[0]["issues"] == "sửa"


def test_expected_mode_is_optional_and_validated(client):
    login_admin(client)
    assert client.post("/api/shifts", json=BASE).status_code == 200
    assert client.post("/api/shifts", json=BASE).status_code == 200
    assert client.post("/api/shifts", json=dict(BASE, expected_mode="overwrite")).status_code == 422


def test_other_leaders_report_still_returns_403_even_with_create_mode(client):
    create_active_user(client, "tan", "Tân")
    create_active_user(client, "hai", "Hải")
    login(client, "tan", "leader123")
    assert client.post("/api/shifts", json=dict(BASE, expected_mode="create")).status_code == 200
    login(client, "hai", "leader123")
    assert client.post("/api/shifts", json=dict(BASE, expected_mode="create")).status_code == 403


def test_length_errors_are_reported_in_vietnamese(client):
    login_admin(client)
    resp = client.post("/api/shifts", json=dict(BASE, end_time="x" * 101))
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert "Giờ kết thúc" in detail and "tối đa 100 ký tự" in detail
    resp = client.post("/api/shifts", json=dict(BASE, packaging=[{"product_name": "p" * 101, "customer": "VICO", "weight_sorted": 1}]))
    assert "Bao gói #1 - Tên sản phẩm: tối đa 100 ký tự" in resp.json()["detail"]
    resp = client.post("/api/shifts", json=dict(BASE, staff_total=5000, staff_present=5))
    assert "Tổng sĩ số: không được lớn hơn 1.000" in resp.json()["detail"]
