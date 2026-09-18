from helpers import create_active_user


def _login_admin(client):
    client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})


def _create_leader(client, username, full_name, password="leader123"):
    return create_active_user(client, username, full_name, password)


def _login(client, username, password="leader123"):
    resp = client.post("/api/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200


SAMPLE_SHIFT = {
    "report_date": "2026-09-16",
    "shift_num": 1,
    "safety_ppe": True,
    "safety_equip": True,
    "staff_total": 5,
    "staff_present": 5,
    "leave_permitted": 0,
    "leave_permitted_names": "",
    "leave_unpermitted": 0,
    "leave_unpermitted_names": "",
    "issues": "None",
    "suggestions": "None",
    "start_time": "6h",
    "end_time": "14h",
    "packaging": [{"product_name": "D25", "customer": "VICO", "weight_sorted": 1000, "weight_waste": 10, "notes": "ok"}],
    "baskets": [{"product_name": "D25", "customer": "VICO", "steel_grade": "CR18", "basket_count": 4, "total_weight": 1400, "notes": ""}],
    "tumbling": [{"product_name": "D25", "customer": "VICO", "m1": 2, "m2": 0, "total_weight": 700, "notes": ""}]
}


def test_check_status_not_found(client):
    _login_admin(client)
    res = client.get("/api/shifts/check-status?date=2099-01-01&shift_num=1")
    assert res.status_code == 200
    data = res.json()
    assert data["exists"] is False


def test_check_status_owner_and_other_leader(client):
    _create_leader(client, "hai", "Hải")
    _create_leader(client, "trong", "Trọng")

    # Hai submits shift
    _login(client, "hai")
    submit_res = client.post("/api/shifts", json=SAMPLE_SHIFT)
    assert submit_res.status_code == 200

    # Hai checks status -> can_edit is True, shift_data is present
    res1 = client.get("/api/shifts/check-status?date=2026-09-16&shift_num=1")
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["exists"] is True
    assert data1["can_edit"] is True
    assert data1["shift_data"] is not None
    assert len(data1["shift_data"]["packaging"]) == 1

    # Trong checks status -> can_edit is False, shift_data is None
    _login(client, "trong")
    res2 = client.get("/api/shifts/check-status?date=2026-09-16&shift_num=1")
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["exists"] is True
    assert data2["can_edit"] is False
    assert data2["shift_data"] is None

    # Admin checks status -> can_edit is True, shift_data is present
    _login_admin(client)
    res_admin = client.get("/api/shifts/check-status?date=2026-09-16&shift_num=1")
    assert res_admin.status_code == 200
    data_admin = res_admin.json()
    assert data_admin["exists"] is True
    assert data_admin["can_edit"] is True
    assert data_admin["shift_data"] is not None


def test_previous_template_endpoint(client):
    _login_admin(client)
    # When empty
    res0 = client.get("/api/shifts/previous-template")
    assert res0.status_code == 200
    assert res0.json()["found"] is False

    # When shift exists
    submit_res = client.post("/api/shifts", json=SAMPLE_SHIFT)
    assert submit_res.status_code == 200

    res = client.get("/api/shifts/previous-template")
    assert res.status_code == 200
    data = res.json()
    assert data["found"] is True
    assert len(data["packaging"]) >= 1
    assert data["packaging"][0]["product_name"] == "D25"
    assert data["baskets"][0]["steel_grade"] == "CR18"
