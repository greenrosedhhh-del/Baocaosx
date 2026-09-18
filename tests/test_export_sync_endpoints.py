"""Hợp đồng với excel_service: xuất Excel ra file tạm (không ghi vào thư mục dự án) và
đồng bộ file gốc báo lỗi 409 khi excel_service.MasterSyncError."""
import os
from pathlib import Path

import excel_service
from helpers import login_admin

DAY = "2026-09-17"
PROJECT_DIR = Path(__file__).resolve().parent.parent


def _seed(client):
    login_admin(client)
    assert client.post("/api/shifts", json={
        "report_date": DAY, "shift_num": 1,
        "packaging": [{"product_name": "D25", "customer": "VICO", "weight_sorted": 100}],
    }).status_code == 200


def test_export_writes_to_temp_file_and_removes_it_afterwards(client, monkeypatch):
    _seed(client)
    seen = {}

    def fake_generate(summary, output_path=None):
        seen["output_path"] = output_path
        seen["summary_date"] = summary["report_date"]
        assert output_path is not None
        with open(output_path, "wb") as f:
            f.write(b"PK-fake-xlsx")
        return output_path

    monkeypatch.setattr(excel_service, "generate_excel_report", fake_generate)
    resp = client.get("/api/export-excel", params={"date": DAY})

    assert resp.status_code == 200
    assert resp.content == b"PK-fake-xlsx"
    assert "BAO_CAO_TONG_HOP_20260917.xlsx" in resp.headers.get("content-disposition", "")
    assert seen["summary_date"] == DAY
    out = Path(seen["output_path"]).resolve()
    assert PROJECT_DIR not in out.parents
    assert not out.exists(), "file tạm phải bị xóa sau khi gửi"


def test_export_uses_unique_temp_files(client, monkeypatch):
    _seed(client)
    paths = []

    def fake_generate(summary, output_path=None):
        paths.append(output_path)
        with open(output_path, "wb") as f:
            f.write(b"x")
        return output_path

    monkeypatch.setattr(excel_service, "generate_excel_report", fake_generate)
    client.get("/api/export-excel", params={"date": DAY})
    client.get("/api/export-excel", params={"date": DAY})
    assert len(paths) == 2 and paths[0] != paths[1]


def test_export_failure_cleans_up_temp_file(client, monkeypatch):
    _seed(client)
    paths = []

    def failing_generate(summary, output_path=None):
        paths.append(output_path)
        with open(output_path, "wb") as f:
            f.write(b"partial")
        raise RuntimeError("template hỏng")

    monkeypatch.setattr(excel_service, "generate_excel_report", failing_generate)
    resp = client.get("/api/export-excel", params={"date": DAY})
    assert resp.status_code == 500
    assert "template hỏng" not in resp.text
    assert paths and not os.path.exists(paths[0])


def test_sync_master_sync_error_returns_409(client, monkeypatch):
    _seed(client)

    def locked(summary):
        raise excel_service.MasterFileLockedError("File tổng hợp gốc đang được mở trong Excel")

    monkeypatch.setattr(excel_service, "sync_to_master", locked)
    resp = client.post("/api/sync-to-master", params={"date": DAY})
    assert resp.status_code == 409
    assert resp.json()["detail"] == "File tổng hợp gốc đang được mở trong Excel"


def test_sync_master_busy_error_returns_409(client, monkeypatch):
    _seed(client)

    def busy(summary):
        raise excel_service.MasterFileBusyError("Đang có một lần đồng bộ khác")

    monkeypatch.setattr(excel_service, "sync_to_master", busy)
    assert client.post("/api/sync-to-master", params={"date": DAY}).status_code == 409


def test_sync_master_missing_file_still_returns_400(client, monkeypatch):
    _seed(client)

    def missing(summary):
        raise FileNotFoundError("x")

    monkeypatch.setattr(excel_service, "sync_to_master", missing)
    assert client.post("/api/sync-to-master", params={"date": DAY}).status_code == 400
