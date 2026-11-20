from helpers import create_active_user, login, login_admin


def test_get_presets_authenticated(client):
    create_active_user(client, "trong", "Vũ Văn Trọng")
    login(client, "trong", "leader123")

    res = client.get("/api/presets")
    assert res.status_code == 200
    data = res.json()
    assert "products" in data
    assert "customers" in data
    assert "steel_grades" in data
    assert "D25" in data["products"]
    assert "Molycop" in data["customers"]
    assert "CR18" in data["steel_grades"]


def test_admin_presets_crud(client):
    create_active_user(client, "trong", "Vũ Văn Trọng")

    # Leader cannot access admin presets
    login(client, "trong", "leader123")
    res = client.get("/api/admin/presets")
    assert res.status_code == 403

    # Admin list presets
    login_admin(client)
    res = client.get("/api/admin/presets")
    assert res.status_code == 200
    items = res.json()
    assert len(items) >= 12

    # Admin add preset
    res = client.post("/api/admin/presets", json={
        "category": "product",
        "name": "D100_TEST",
        "sort_order": 10
    })
    assert res.status_code == 200
    new_id = res.json()["id"]

    # Duplicate rejected
    res_dup = client.post("/api/admin/presets", json={
        "category": "product",
        "name": "D100_TEST",
        "sort_order": 10
    })
    assert res_dup.status_code == 400

    # User presets now includes new item
    login(client, "trong", "leader123")
    res_presets = client.get("/api/presets")
    assert "D100_TEST" in res_presets.json()["products"]

    # Admin update preset
    login_admin(client)
    res_patch = client.patch(f"/api/admin/presets/{new_id}", json={
        "name": "D100_UPDATED",
        "sort_order": 5
    })
    assert res_patch.status_code == 200

    # Admin delete preset
    res_del = client.delete(f"/api/admin/presets/{new_id}")
    assert res_del.status_code == 200

    # Verify deleted
    login(client, "trong", "leader123")
    res_presets2 = client.get("/api/presets")
    assert "D100_UPDATED" not in res_presets2.json()["products"]


def test_period_summary(client):
    create_active_user(client, "trong", "Vũ Văn Trọng")
    login(client, "trong", "leader123")

    # Invalid date range
    res_inv = client.get("/api/period-summary?start_date=2026-09-20&end_date=2026-09-10")
    assert res_inv.status_code == 400

    # Valid date range
    res = client.get("/api/period-summary?start_date=2026-09-01&end_date=2026-09-30")
    assert res.status_code == 200
    data = res.json()
    assert "attendance" in data
    assert "packaging" in data
    assert "baskets" in data
    assert "tumbling" in data
    assert "daily_series" in data
    assert "by_shift" in data
    assert len(data["daily_series"]) == 30
    assert data["daily_series"][0]["date"] == "2026-09-01"
    assert data["daily_series"][-1]["date"] == "2026-09-30"


def test_admin_backup_db(client):
    create_active_user(client, "trong", "Vũ Văn Trọng")

    # Leader forbidden
    login(client, "trong", "leader123")
    res_lead = client.get("/api/admin/backup-db")
    assert res_lead.status_code == 403

    # Admin can download backup
    login_admin(client)
    res = client.get("/api/admin/backup-db")
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/x-sqlite3"
    assert len(res.content) > 1024  # At least 1KB valid SQLite


def test_admin_download_master_excel(client):
    create_active_user(client, "trong", "Vũ Văn Trọng")

    # Leader forbidden
    login(client, "trong", "leader123")
    res_lead = client.get("/api/admin/download-master-excel")
    assert res_lead.status_code == 403

    # Admin download
    login_admin(client)
    res = client.get("/api/admin/download-master-excel")
    # If master file exists, 200, else 404
    assert res.status_code in (200, 404)
    if res.status_code == 200:
        assert len(res.content) > 1000
