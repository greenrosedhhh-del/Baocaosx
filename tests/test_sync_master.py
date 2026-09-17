import excel_service


def test_sync_to_master_returns_400_when_master_file_missing(client, tmp_path, monkeypatch):
    monkeypatch.setattr(excel_service, "MASTER_PATH", str(tmp_path / "missing.xlsx"))
    client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    client.post("/api/shifts", json={"report_date": "2026-09-17", "shift_num": 1})

    resp = client.post("/api/sync-to-master", params={"date": "2026-09-17"})

    assert resp.status_code == 400
    assert "BÁO CÁO TỔNG HỢP" in resp.json()["detail"]
