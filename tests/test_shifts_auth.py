def _login_admin(client):
    client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})


def _create_leader(client, username, full_name, password="leader123"):
    _login_admin(client)
    resp = client.post("/api/admin/users", json={
        "username": username, "full_name": full_name, "password": password, "role": "leader"
    })
    assert resp.status_code == 200
    client.post("/api/auth/logout")


def _login(client, username, password="leader123"):
    resp = client.post("/api/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200


SAMPLE_SHIFT = {
    "report_date": "2026-09-17",
    "shift_num": 1,
    "safety_ppe": True,
    "safety_equip": True,
    "staff_total": 5,
    "staff_present": 5,
    "leave_permitted": 0,
    "leave_permitted_names": "",
    "leave_unpermitted": 0,
    "leave_unpermitted_names": "",
    "issues": "",
    "suggestions": "",
    "start_time": "6h",
    "end_time": "14h",
    "packaging": [],
    "baskets": [],
    "tumbling": []
}


def test_unauthenticated_cannot_submit_shift(client):
    resp = client.post("/api/shifts", json=SAMPLE_SHIFT)
    assert resp.status_code == 401


def test_shift_leader_name_is_forced_from_account(client):
    _create_leader(client, "tan", "Tân")
    _login(client, "tan")

    resp = client.post("/api/shifts", json=SAMPLE_SHIFT)
    assert resp.status_code == 200

    _login_admin(client)
    resp = client.get("/api/shifts", params={"date": "2026-09-17"})
    shifts = resp.json()
    assert len(shifts) == 1
    assert shifts[0]["shift_leader"] == "Tân"


def test_leader_cannot_overwrite_another_leaders_shift(client):
    _create_leader(client, "tan", "Tân")
    _create_leader(client, "hai", "Hải")

    _login(client, "tan")
    resp = client.post("/api/shifts", json=SAMPLE_SHIFT)
    assert resp.status_code == 200
    client.post("/api/auth/logout")

    _login(client, "hai")
    resp = client.post("/api/shifts", json=SAMPLE_SHIFT)
    assert resp.status_code == 403


def test_leader_can_edit_own_shift(client):
    _create_leader(client, "tan", "Tân")
    _login(client, "tan")

    client.post("/api/shifts", json=SAMPLE_SHIFT)
    edited = dict(SAMPLE_SHIFT, suggestions="Cần thêm bao tay")
    resp = client.post("/api/shifts", json=edited)
    assert resp.status_code == 200


def test_leader_only_sees_own_shifts_in_list(client):
    _create_leader(client, "tan", "Tân")
    _create_leader(client, "hai", "Hải")

    _login(client, "tan")
    client.post("/api/shifts", json=SAMPLE_SHIFT)
    client.post("/api/auth/logout")

    _login(client, "hai")
    shift2 = dict(SAMPLE_SHIFT, shift_num=2)
    client.post("/api/shifts", json=shift2)

    resp = client.get("/api/shifts", params={"date": "2026-09-17"})
    shifts = resp.json()
    assert len(shifts) == 1
    assert shifts[0]["shift_num"] == 2


def test_leader_cannot_access_daily_summary(client):
    _create_leader(client, "tan", "Tân")
    _login(client, "tan")
    resp = client.get("/api/daily-summary", params={"date": "2026-09-17"})
    assert resp.status_code == 403


def test_admin_can_access_daily_summary(client):
    _login_admin(client)
    resp = client.get("/api/daily-summary", params={"date": "2026-09-17"})
    assert resp.status_code == 200
