import os
import re
import tempfile
import zipfile
import xml.etree.ElementTree as ET

import openpyxl
import pytest
from openpyxl.drawing.image import Image as XLImage
from PIL import Image as PILImage

import excel_service


def _summary(**overrides):
    base = {
        "report_date": "2026-09-17",
        "attendance": {},
        "packaging": [],
        "baskets": [],
        "tumbling": [],
        "issues": [],
        "suggestions": "KO",
    }
    base.update(overrides)
    return base


def _sheet(tmp_path, summary):
    path = excel_service.generate_excel_report(summary, str(tmp_path / "out.xlsx"))
    return openpyxl.load_workbook(path).active


# ---------- Gộp dòng vượt quá số dòng của mẫu ----------

def test_packaging_rows_beyond_template_are_merged_into_last_row(tmp_path):
    items = [
        {"product_name": f"P{i}", "customer": "X", "weight_sorted": 100 * (i + 1), "weight_waste": i, "notes": ""}
        for i in range(6)
    ]
    ws = _sheet(tmp_path, _summary(packaging=items))

    assert [ws.cell(r, 1).value for r in range(11, 14)] == ["P0", "P1", "P2"]
    assert ws.cell(14, 1).value == "Khác"
    assert ws.cell(14, 5).value == 400 + 500 + 600
    assert ws.cell(14, 7).value == 3 + 4 + 5
    merged_note = ws.cell(14, 10).value
    assert all(name in merged_note for name in ("P3", "P4", "P5"))
    assert ws.cell(15, 5).value is None


def test_basket_rows_beyond_template_are_merged_into_last_row(tmp_path):
    items = [
        {"product_name": f"B{i}", "customer": "X", "steel_grade": "CR18",
         "basket_count": i + 1, "total_weight": (i + 1) * 350, "notes": ""}
        for i in range(6)
    ]
    ws = _sheet(tmp_path, _summary(baskets=items))

    assert ws.cell(24, 1).value == "Khác"
    assert ws.cell(24, 7).value == 4 + 5 + 6
    assert ws.cell(24, 9).value == (4 + 5 + 6) * 350


def test_basket_notes_do_not_overwrite_total_weight(tmp_path):
    items = [{"product_name": "D25", "customer": "Molycop", "steel_grade": "CR18",
              "basket_count": 12, "total_weight": 4200, "notes": "Dừng lò sửa chữa từ 8h"}]
    ws = _sheet(tmp_path, _summary(baskets=items))

    assert ws.cell(21, 9).value == 4200
    assert "Dừng lò sửa chữa từ 8h" in ws.cell(25, 1).value


def test_tumbling_rows_beyond_template_are_merged_into_last_row(tmp_path):
    items = [
        {"product_name": f"T{i}", "customer": "X", "m1": 1, "m2": 2, "total_weight": 1000, "notes": ""}
        for i in range(8)
    ]
    ws = _sheet(tmp_path, _summary(tumbling=items))

    assert ws.cell(34, 1).value == "T4"
    assert ws.cell(35, 1).value == "Khác"
    assert ws.cell(35, 3).value == 3
    assert ws.cell(35, 5).value == 6
    assert ws.cell(35, 7).value == 3000


def test_rows_within_template_limit_are_written_unchanged(tmp_path):
    items = [
        {"product_name": f"P{i}", "customer": "X", "weight_sorted": 100, "weight_waste": 1, "notes": ""}
        for i in range(4)
    ]
    ws = _sheet(tmp_path, _summary(packaging=items))
    assert [ws.cell(r, 1).value for r in range(11, 15)] == ["P0", "P1", "P2", "P3"]


def _all_values(ws):
    return [c.value for row in ws.iter_rows() for c in row if c.value is not None]


# ---------- Bug 1: ký tự điều khiển trong dữ liệu cũ ----------

def test_control_characters_in_any_field_are_removed_instead_of_crashing(tmp_path):
    bad = "A\x00B\x08C\x0bD\x0cE\x0eF\x1fG\ufffeH"
    summary = _summary(
        attendance={"total_staff": 5, "present": 4, "leave_notes": bad, "leave_detail": bad, "unpermitted": bad},
        packaging=[{"product_name": bad, "customer": bad, "from_val": bad, "to_val": bad,
                    "weight_sorted": 100, "weight_waste": 1, "notes": bad}],
        packaging_notes=[bad, bad],
        baskets=[{"product_name": bad, "customer": bad, "steel_grade": bad, "basket_count": 2,
                  "total_weight": None, "notes": bad}],
        basket_notes=bad,
        tumbling=[{"product_name": bad, "customer": bad, "m1": 1, "m2": 1, "total_weight": 10, "notes": bad}],
        issues=[bad], suggestions=bad, reporter_name=bad,
    )
    path = excel_service.generate_excel_report(summary, str(tmp_path / "out.xlsx"))

    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            if name.endswith(".xml") or name.endswith(".rels"):
                ET.fromstring(z.read(name))  # mọi part phải là XML hợp lệ
    ws = openpyxl.load_workbook(path).active
    assert ws["A11"].value == "ABCDEFGH"
    assert ws["J11"].value == "ABCDEFGH"
    assert "ABCDEFGH" in ws["A37"].value
    for value in _all_values(ws):
        if isinstance(value, str):
            assert not re.search("[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]", value)


# ---------- Bug 2: chuỗi bắt đầu bằng = + - @ không được thành công thức ----------

@pytest.mark.parametrize("text", [
    "=> chuyển kho",
    '=HYPERLINK("http://evil.example","bấm vào")',
    "+84 912 345 678",
    "@khach",
    "-5 bao",
])
def test_user_text_that_looks_like_a_formula_is_stored_as_text(tmp_path, text):
    summary = _summary(
        packaging=[{"product_name": text, "customer": "X", "weight_sorted": 100, "weight_waste": 1, "notes": text}],
        tumbling=[{"product_name": "D25", "customer": "X", "m1": 1, "m2": 1, "total_weight": 10, "notes": text}],
        suggestions=text,
    )
    path = excel_service.generate_excel_report(summary, str(tmp_path / "out.xlsx"))
    ws = openpyxl.load_workbook(path).active

    for coord in ("A11", "J11", "I30", "A37"):
        assert ws[coord].value == text, coord
        assert ws[coord].data_type == "s", coord
    with zipfile.ZipFile(path) as z:
        sheet_xml = z.read("xl/worksheets/sheet1.xml").decode("utf-8")
    assert "HYPERLINK" not in "".join(re.findall(r"<f>(.*?)</f>", sheet_xml))


def test_generated_formulas_are_still_formulas(tmp_path):
    summary = _summary(
        packaging=[{"product_name": "D25", "customer": "X", "weight_sorted": 1000, "weight_waste": 25, "notes": ""}],
        baskets=[{"product_name": "D25", "customer": "X", "steel_grade": "CR18", "basket_count": 3,
                  "total_weight": None, "notes": ""}],
    )
    ws = _sheet(tmp_path, summary)
    assert ws["I11"].data_type == "f" and ws["I11"].value == "=G11/E11*100"
    assert ws["I21"].data_type == "f" and ws["I21"].value == "=G21*350"


# ---------- Bug 5: không bỏ sót ghi chú bao gói ----------

def test_all_packaging_notes_are_written(tmp_path):
    notes = [" - Sắp xếp kho bi chờ nghiệm thu", " - Kéo sọt bi trong lò NLLT", " - Vệ sinh xếp kho", " - Nhặt bi lỗi lò 2"]
    ws = _sheet(tmp_path, _summary(packaging_notes=notes))

    written = f"{ws['A15'].value} {ws['A16'].value}"
    assert ws["A15"].value == notes[0]
    for note in notes:
        assert note.strip(" -") in written


def test_two_packaging_notes_go_to_their_own_rows(tmp_path):
    notes = [" - Sắp xếp kho bi chờ nghiệm thu", " - Kéo sọt bi trong lò NLLT"]
    ws = _sheet(tmp_path, _summary(packaging_notes=notes))
    assert (ws["A15"].value, ws["A16"].value) == tuple(notes)


# ---------- Bug 6: nhãn/ô khớp với báo cáo thật ----------

SHIFT_TIME_LINES = [
    "Thời gian làm việc của Ca 1 từ :   6h - 14h ",
    "Thời gian làm việc của Ca 2 từ :  14h - 22h ",
    "Thời gian làm việc của Ca 3 từ :  22h - 6h ",
]


def test_shift_time_lines_sit_below_the_header_without_template_leftovers(tmp_path):
    ws = _sheet(tmp_path, _summary())
    assert ws["A36"].value == "Yêu cầu - Đề xuất"
    assert [ws["I37"].value, ws["I38"].value, ws["I39"].value] == SHIFT_TIME_LINES
    assert ws["I40"].value is None
    joined = "\n".join(str(v) for v in _all_values(ws))
    assert "Thời gian bắt đầu ca làm việc" not in joined
    assert "Thời gian kết thúc ca làm việc" not in joined


def test_suggestions_go_right_below_the_header(tmp_path):
    ws = _sheet(tmp_path, _summary(suggestions="Ca 1: bổ sung găng tay"))
    assert ws["A37"].value == "Ca 1: bổ sung găng tay"
    assert ws["A38"].value is None


def test_reporter_label_and_name(tmp_path):
    ws = _sheet(tmp_path, _summary(reporter_name="Ngọc Quang"))
    assert ws["I44"].value == "Người báo cáo:"
    assert ws["H45"].value.strip() == "Ngọc Quang"
    assert not any("Trưởng ca" in str(v) for v in _all_values(ws))


def test_submitted_shifts_fill_the_ca_line(tmp_path):
    ws = _sheet(tmp_path, _summary(submitted_shifts=[1, 2, 3]))
    assert ws["A6"].value == "Ca: 1, 2, 3"


def test_safety_checkboxes_are_ticked_when_no_shift_failed(tmp_path):
    ws = _sheet(tmp_path, _summary(safety={"ppe_failed_shifts": [], "equip_failed_shifts": []}))
    assert ws["D7"].value == "☑ Bảo hộ đầy đủ"
    assert ws["J7"].value == "☑ Thiết bị an toàn"


def test_safety_checkboxes_name_the_failed_shifts(tmp_path):
    ws = _sheet(tmp_path, _summary(safety={"ppe_failed_shifts": [2], "equip_failed_shifts": [1, 3]}))
    assert ws["D7"].value == "☐ Bảo hộ đầy đủ (Ca 2: không đạt)"
    assert ws["J7"].value == "☐ Thiết bị an toàn (Ca 1, 3: không đạt)"


def test_missing_safety_info_keeps_template_text(tmp_path):
    ws = _sheet(tmp_path, _summary())
    assert ws["D7"].value == "□ Bảo hộ đầy đủ"
    assert ws["J7"].value == "□ Thiết bị an toàn"


def test_report_is_set_up_for_a4_single_page(tmp_path):
    ws = _sheet(tmp_path, _summary())
    assert int(ws.page_setup.paperSize) == 9
    assert ws.page_setup.orientation == "portrait"
    assert ws.sheet_properties.pageSetUpPr.fitToPage
    assert int(ws.page_setup.fitToWidth) == 1 and int(ws.page_setup.fitToHeight) == 1


# ---------- Bug 7: không ghi file xuất vào thư mục dự án ----------

def test_default_output_is_a_unique_temp_file_outside_the_project(tmp_path, monkeypatch):
    # Trỏ "thư mục dự án" của module sang tmp để test không bao giờ ghi/xóa file thật trong D:\Disa
    fake_project = tmp_path / "project"
    fake_project.mkdir()
    monkeypatch.setattr(excel_service, "__file__", str(fake_project / "excel_service.py"))
    system_temp = tmp_path / "system_temp"
    system_temp.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(system_temp))

    first = excel_service.generate_excel_report(_summary())
    second = excel_service.generate_excel_report(_summary())

    assert first != second
    for path in (first, second):
        assert os.path.isfile(path)
        assert os.path.dirname(os.path.abspath(path)) == str(system_temp)
    assert list(fake_project.iterdir()) == []


# ---------- Đồng bộ file gốc không làm phình ảnh ----------

def _make_master_with_repeated_logo(tmp_path, sheet_count=3):
    logo = tmp_path / "logo.png"
    PILImage.new("RGB", (40, 20), "red").save(logo)
    wb = openpyxl.Workbook()
    for i in range(sheet_count):
        ws = wb.active if i == 0 else wb.create_sheet()
        ws.title = f"{i + 1:02d}.09.26 "
        ws["C1"] = "CÔNG TY TNHH THẮNG LỢI"
        ws.add_image(XLImage(str(logo)), "A1")
    master = tmp_path / "master.xlsx"
    wb.save(master)
    return master


def _media_parts(path):
    with zipfile.ZipFile(path) as z:
        return [n for n in z.namelist() if n.startswith("xl/media/")]


def _missing_relationship_targets(path):
    missing = []
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        for rels in (n for n in names if n.startswith("xl/drawings/_rels/")):
            for target in re.findall(r'Target="([^"]+)"', z.read(rels).decode("utf-8")):
                resolved = target.lstrip("/") if target.startswith("/") else os.path.normpath(
                    os.path.join("xl/drawings", target)).replace("\\", "/")
                if resolved not in names:
                    missing.append(resolved)
    return missing


@pytest.fixture()
def master(tmp_path, monkeypatch):
    path = _make_master_with_repeated_logo(tmp_path)
    monkeypatch.setattr(excel_service, "MASTER_PATH", str(path))
    monkeypatch.setattr(excel_service, "BACKUP_DIR", str(tmp_path / "backups"))
    return path


def test_sync_to_master_does_not_add_or_duplicate_images(master):
    media_before = sorted(_media_parts(master))
    excel_service.sync_to_master(_summary(packaging=[
        {"product_name": "D25", "customer": "VICO", "weight_sorted": 100, "weight_waste": 1, "notes": ""}
    ]))

    assert sorted(_media_parts(master)) == media_before
    assert _missing_relationship_targets(master) == []

    wb = openpyxl.load_workbook(master)
    for name in ("01.09.26 ", "02.09.26 ", "03.09.26 "):
        assert len(wb[name]._images) == 1
    assert "17.09.26 " in wb.sheetnames


def test_sync_to_master_twice_keeps_media_count(master):
    media_before = sorted(_media_parts(master))
    excel_service.sync_to_master(_summary())
    excel_service.sync_to_master(_summary(report_date="2026-09-18"))
    assert sorted(_media_parts(master)) == media_before
    assert _missing_relationship_targets(master) == []
    wb = openpyxl.load_workbook(master)
    assert wb.sheetnames == ["01.09.26 ", "02.09.26 ", "03.09.26 ", "17.09.26 ", "18.09.26 "]
    assert len(wb["18.09.26 "]._images) == 1


# ---------- Giới hạn số bản sao lưu ----------

def test_backup_keeps_only_most_recent_copies(tmp_path, monkeypatch):
    master = tmp_path / "master.xlsx"
    openpyxl.Workbook().save(master)
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    for i in range(12):
        (backup_dir / f"BAO_CAO_TONG_HOP_backup_20260901_0000{i:02d}.xlsx").write_bytes(b"old")
    monkeypatch.setattr(excel_service, "MASTER_PATH", str(master))
    monkeypatch.setattr(excel_service, "BACKUP_DIR", str(backup_dir))

    new_backup = excel_service.backup_master_workbook()

    remaining = sorted(os.listdir(backup_dir))
    assert len(remaining) == excel_service.MAX_BACKUPS
    assert os.path.basename(new_backup) in remaining
    assert "BAO_CAO_TONG_HOP_backup_20260901_000000.xlsx" not in remaining
