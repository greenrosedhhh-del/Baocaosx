"""#5: tổng hợp ngày (NULL/0 khối lượng giỏ, ghi chú rỗng, từ khóa ghi chú bao gói, thứ tự ca trong lịch sử)
và khóa "safety" dùng cho file Excel."""
from helpers import login_admin

DAY = "2026-09-15"


def _post(client, shift_num, **fields):
    payload = {"report_date": fields.pop("report_date", DAY), "shift_num": shift_num}
    payload.update(fields)
    resp = client.post("/api/shifts", json=payload)
    assert resp.status_code == 200, resp.text


def _summary(client, report_date=DAY):
    resp = client.get("/api/daily-summary", params={"date": report_date})
    assert resp.status_code == 200
    return resp.json()


def test_basket_weight_uses_count_times_350_only_for_null_rows(client):
    login_admin(client)
    _post(client, 1, baskets=[{"product_name": "D25", "customer": "VICO", "steel_grade": "CR18",
                               "basket_count": 2, "total_weight": None}])
    _post(client, 2, baskets=[{"product_name": "D25", "customer": "VICO", "steel_grade": "CR18",
                               "basket_count": 3, "total_weight": 1000}])
    rows = _summary(client)["baskets"]
    assert len(rows) == 1
    assert rows[0]["basket_count"] == 5
    assert rows[0]["total_weight"] == 1700


def test_basket_weight_zero_is_kept_as_zero(client):
    login_admin(client)
    _post(client, 1, baskets=[{"product_name": "D25", "customer": "VICO", "steel_grade": "CR18",
                               "basket_count": 2, "total_weight": 0}])
    assert _summary(client)["baskets"][0]["total_weight"] == 0


def test_empty_notes_are_not_concatenated(client):
    login_admin(client)
    _post(client, 1, packaging=[{"product_name": "D25", "customer": "VICO", "weight_sorted": 100, "notes": ""}],
          baskets=[{"product_name": "D25", "customer": "VICO", "steel_grade": "CR18", "basket_count": 1, "notes": ""}])
    _post(client, 2, packaging=[{"product_name": "D25", "customer": "VICO", "weight_sorted": 100, "notes": "   "}],
          baskets=[{"product_name": "D25", "customer": "VICO", "steel_grade": "CR18", "basket_count": 1, "notes": "Giỏ 3 méo"}])
    _post(client, 3, packaging=[{"product_name": "D25", "customer": "VICO", "weight_sorted": 100, "notes": "Nhặt bi lỗi"}])
    summary = _summary(client)
    assert summary["packaging"][0]["notes"] == "Nhặt bi lỗi"
    assert summary["baskets"][0]["notes"] == "Giỏ 3 méo"


def test_all_empty_notes_give_empty_string(client):
    login_admin(client)
    _post(client, 1, packaging=[{"product_name": "D25", "customer": "VICO", "weight_sorted": 100, "notes": ""}])
    _post(client, 2, packaging=[{"product_name": "D25", "customer": "VICO", "weight_sorted": 100, "notes": ""}])
    summary = _summary(client)
    assert summary["packaging"][0]["notes"] == ""
    assert summary["packaging_notes"] == []


def test_packaging_note_keywords_match_whole_words_only(client):
    login_admin(client)
    _post(client, 1, packaging=[
        {"product_name": "D25", "customer": "VICO", "weight_sorted": 100, "notes": "Khách hài lòng"},
        {"product_name": "D40", "customer": "VICO", "weight_sorted": 100, "notes": "Lò 2 dừng"},
        {"product_name": "D60", "customer": "VICO", "weight_sorted": 100, "notes": "Xếp kho chờ nghiệm thu"},
        {"product_name": "D80", "customer": "VICO", "weight_sorted": 100, "notes": "Lòng máng mòn"},
    ])
    summary = _summary(client)
    by_product = {row["product_name"]: row for row in summary["packaging"]}
    assert by_product["D25"]["notes"] == "Khách hài lòng"
    assert by_product["D80"]["notes"] == "Lòng máng mòn"
    assert by_product["D40"]["notes"] == ""
    assert by_product["D60"]["notes"] == ""
    joined = " | ".join(summary["packaging_notes"])
    assert "Lò 2 dừng" in joined and "nghiệm thu" in joined
    assert "hài lòng" not in joined and "Lòng máng" not in joined


def test_packaging_note_keywords_match_decomposed_unicode(client):
    login_admin(client)
    decomposed = "lò 3 hỏng"  # "lò 3 hỏng" gõ bằng dấu tổ hợp
    _post(client, 1, packaging=[{"product_name": "D25", "customer": "VICO", "weight_sorted": 100, "notes": decomposed}])
    assert len(_summary(client)["packaging_notes"]) == 1


def test_history_lists_shifts_and_leaders_in_shift_order(client):
    login_admin(client)
    for n in (3, 1, 2):
        _post(client, n)
    history = client.get("/api/history").json()
    row = next(r for r in history if r["report_date"] == DAY)
    assert row["shifts"] == "1,2,3"
    assert row["shift_count"] == 3


def test_history_is_limited_to_30_latest_dates(client):
    login_admin(client)
    for day in range(1, 33):
        _post(client, 1, report_date=f"2026-08-{day:02d}" if day <= 31 else "2026-09-01")
    history = client.get("/api/history").json()
    assert len(history) == 30
    assert history[0]["report_date"] == "2026-09-01"
    assert [r["report_date"] for r in history] == sorted([r["report_date"] for r in history], reverse=True)


def test_summary_reports_safety_failures_per_shift(client):
    login_admin(client)
    _post(client, 1, safety_production=False, safety_ppe=False)
    _post(client, 2, safety_equip=False)
    _post(client, 3)
    assert _summary(client)["safety"] == {
        "production_failed_shifts": [1],
        "ppe_failed_shifts": [1],
        "equip_failed_shifts": [2],
    }


def test_summary_safety_key_present_when_all_ok_and_for_empty_day(client):
    login_admin(client)
    _post(client, 1)
    assert _summary(client)["safety"] == {
        "production_failed_shifts": [],
        "ppe_failed_shifts": [],
        "equip_failed_shifts": [],
    }
    assert _summary(client, "2026-01-01")["safety"] == {
        "production_failed_shifts": [],
        "ppe_failed_shifts": [],
        "equip_failed_shifts": [],
    }
