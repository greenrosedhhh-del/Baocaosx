"""Đồng bộ báo cáo ngày vào file BÁO CÁO TỔNG HỢP ở mức zip/XML.

File mẫu tests/test_excel_master_fixture.xlsx được tạo bằng Microsoft Excel thật: có calcChain,
printerSettings, đường nối (xdr:cxnSp), ảnh dùng chung giữa các sheet, definedName theo sheet.
Thứ tự sheet: "Báo cáo TH", "01.09.26 ", "03.09.26" (sheet đang chọn), "Sheet1".
"""
import os
import posixpath
import re
import shutil
import sys
import threading
import zipfile
import xml.etree.ElementTree as ET

import openpyxl
import pytest

import excel_service

FIXTURE = os.path.join(os.path.dirname(__file__), "test_excel_master_fixture.xlsx")

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
XDR_NS = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"


def _summary(report_date="2026-09-02", **overrides):
    base = {
        "report_date": report_date,
        "submitted_shifts": [1, 2],
        "attendance": {"total_staff": 15, "present": 12},
        "packaging": [{"product_name": "D25", "customer": "Molycop", "weight_sorted": 1000,
                       "weight_waste": 25, "notes": "Nhặt bi lỗi"}],
        "packaging_notes": [],
        "baskets": [{"product_name": "D25", "customer": "Molycop", "steel_grade": "CR18",
                     "basket_count": 5, "total_weight": None, "notes": ""}],
        "tumbling": [{"product_name": "D25", "customer": "Molycop", "m1": 9, "m2": 9,
                      "total_weight": 24200, "notes": ""}],
        "issues": ["Máy xóc 1 hỏng nút ấn"],
        "suggestions": "KO",
        "reporter_name": "Ngọc Quang",
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------- package helpers

def _parts(path):
    with zipfile.ZipFile(path) as z:
        return {name: z.read(name) for name in z.namelist() if not name.endswith("/")}


def _rels_name(part):
    return posixpath.join(posixpath.dirname(part), "_rels", posixpath.basename(part) + ".rels")


def _rels(parts, part):
    """{Id: (Type, target_part_or_url, external)} của một part."""
    data = parts.get(_rels_name(part))
    if data is None:
        return {}
    out = {}
    for rel in ET.fromstring(data).findall(f"{{{PKG_REL_NS}}}Relationship"):
        target = rel.get("Target")
        external = rel.get("TargetMode") == "External"
        if not external:
            if target.startswith("/"):
                target = target.lstrip("/")
            else:
                target = posixpath.normpath(posixpath.join(posixpath.dirname(part), target))
        out[rel.get("Id")] = (rel.get("Type").rsplit("/", 1)[-1], target, external)
    return out


def _sheets(parts):
    """[(name, sheetId, part)] theo thứ tự tab."""
    wb = ET.fromstring(parts["xl/workbook.xml"])
    rels = _rels(parts, "xl/workbook.xml")
    return [(s.get("name"), s.get("sheetId"), rels[s.get(f"{{{REL_NS}}}id")][1])
            for s in wb.find(f"{{{MAIN_NS}}}sheets")]


def _sheet_names(parts):
    return [name for name, _, _ in _sheets(parts)]


def _sheet_part(parts, name):
    return next(part for n, _, part in _sheets(parts) if n == name)


def _drawing_of(parts, sheet_part):
    return next((t for _, (typ, t, _) in _rels(parts, sheet_part).items() if typ == "drawing"), None)


def _pictures(parts, drawing_part):
    """Danh sách part ảnh mà drawing tham chiếu (theo thứ tự)."""
    rels = _rels(parts, drawing_part)
    root = ET.fromstring(parts[drawing_part])
    blips = root.iter("{http://schemas.openxmlformats.org/drawingml/2006/main}blip")
    return [rels[b.get(f"{{{REL_NS}}}embed")][1] for b in blips]


def _assert_valid_package(path, require_selected_tab=True):
    parts = _parts(path)
    # 1. mọi part XML đều well-formed
    for name, data in parts.items():
        if name.endswith((".xml", ".rels")):
            ET.fromstring(data)
    # 2. mọi relationship nội bộ đều trỏ tới part có thật
    for name in parts:
        if not name.endswith(".rels"):
            continue
        base_dir = posixpath.dirname(posixpath.dirname(name))  # thư mục của part sở hữu, bỏ "_rels"
        for rel in ET.fromstring(parts[name]).findall(f"{{{PKG_REL_NS}}}Relationship"):
            if rel.get("TargetMode") == "External":
                continue
            target = rel.get("Target")
            resolved = target.lstrip("/") if target.startswith("/") else \
                posixpath.normpath(posixpath.join(base_dir, target))
            assert resolved in parts, f"{name}: {rel.get('Id')} -> {resolved} không tồn tại"
    # 3. mọi part đều có content type
    ct = ET.fromstring(parts["[Content_Types].xml"])
    defaults = {d.get("Extension").lower() for d in ct.findall(f"{{{CT_NS}}}Default")}
    overrides = {o.get("PartName").lower() for o in ct.findall(f"{{{CT_NS}}}Override")}
    for name in parts:
        if name == "[Content_Types].xml":
            continue
        assert ("/" + name).lower() in overrides or name.rsplit(".", 1)[-1].lower() in defaults, name
    for override in overrides:
        assert override.lstrip("/") in {n.lower() for n in parts}, f"Override thừa: {override}"
    # Excel cần đúng content type cho worksheet/drawing (Default "xml" = application/xml là KHÔNG đủ)
    typed = {o.get("PartName").lower(): o.get("ContentType") for o in ct.findall(f"{{{CT_NS}}}Override")}
    for name in parts:
        if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name):
            assert typed.get("/" + name.lower(), "").endswith("worksheet+xml"), f"{name} thiếu content type worksheet"
        if re.fullmatch(r"xl/drawings/drawing\d+\.xml", name):
            assert typed.get("/" + name.lower(), "").endswith("drawing+xml"), f"{name} thiếu content type drawing"
    # 4. workbook: sheetId, r:id, tên sheet duy nhất; activeTab hợp lệ; đúng 1 sheet được chọn
    wb = ET.fromstring(parts["xl/workbook.xml"])
    sheets = list(wb.find(f"{{{MAIN_NS}}}sheets"))
    assert len({s.get("sheetId") for s in sheets}) == len(sheets)
    assert len({s.get(f"{{{REL_NS}}}id") for s in sheets}) == len(sheets)
    assert len({s.get("name").lower() for s in sheets}) == len(sheets)
    view = wb.find(f"{{{MAIN_NS}}}bookViews/{{{MAIN_NS}}}workbookView")
    active = int(view.get("activeTab", "0"))
    assert 0 <= active < len(sheets)
    assert int(view.get("firstSheet", "0")) < len(sheets)
    selected = [n for n, _, part in _sheets(parts) if re.search(rb'tabSelected="(1|true)"', parts[part])]
    if require_selected_tab:
        assert selected == [sheets[active].get("name")]
    else:  # file do openpyxl tạo không đánh dấu tab nào
        assert selected in ([], [sheets[active].get("name")])
    for dn in wb.iter(f"{{{MAIN_NS}}}definedName"):
        if dn.get("localSheetId") is not None:
            assert int(dn.get("localSheetId")) < len(sheets)
    assert "xl/calcChain.xml" not in parts
    return parts


def _count(parts, needle):
    return sum(data.count(needle) for name, data in parts.items() if name.startswith("xl/drawings/drawing"))


# ---------------------------------------------------------------- fixtures

@pytest.fixture()
def master(tmp_path, monkeypatch):
    path = tmp_path / "master" / "BÁO CÁO TỔNG HỢP HÀNG NGÀY.xlsx"
    path.parent.mkdir()
    shutil.copyfile(FIXTURE, path)
    monkeypatch.setattr(excel_service, "MASTER_PATH", str(path))
    monkeypatch.setattr(excel_service, "BACKUP_DIR", str(tmp_path / "backups"))
    return path


def _leftovers(directory):
    return sorted(n for n in os.listdir(directory) if n != "BÁO CÁO TỔNG HỢP HÀNG NGÀY.xlsx")


# ---------------------------------------------------------------- Bug 4: tiêm sheet ở mức zip/XML

def test_fixture_is_an_excel_workbook_with_the_parts_that_openpyxl_used_to_destroy():
    parts = _parts(FIXTURE)
    assert b"Microsoft Excel" in parts["docProps/app.xml"]
    assert "xl/calcChain.xml" in parts
    assert len([n for n in parts if n.startswith("xl/printerSettings/")]) == 3
    assert _count(parts, b"<xdr:cxnSp") == 2
    assert _sheet_names(parts) == ["Báo cáo TH", "01.09.26 ", "03.09.26", "Sheet1"]


def test_sync_does_not_load_or_save_the_master_with_openpyxl(master, monkeypatch):
    real_load = openpyxl.load_workbook

    def guarded_load(filename, *args, **kwargs):
        assert os.path.abspath(str(filename)) != os.path.abspath(str(master)), "master bị nạp bằng openpyxl"
        return real_load(filename, *args, **kwargs)

    monkeypatch.setattr(openpyxl, "load_workbook", guarded_load)
    monkeypatch.setattr(excel_service.openpyxl, "load_workbook", guarded_load)
    excel_service.sync_to_master(_summary())


def test_first_sync_leaves_every_other_part_byte_for_byte_untouched(master):
    before = _parts(master)
    result = excel_service.sync_to_master(_summary("2026-09-02"))
    after = _assert_valid_package(master)

    assert result["status"] == "success"
    assert result["sheet_name"] == "02.09.26 "
    allowed_to_change = {"[Content_Types].xml", "xl/workbook.xml", "xl/_rels/workbook.xml.rels",
                         "xl/styles.xml", "docProps/app.xml"}
    for name, data in before.items():
        if name == "xl/calcChain.xml" or name in allowed_to_change:
            continue
        assert after.get(name) == data, f"{name} bị thay đổi"
    added = set(after) - set(before)
    new_sheet = _sheet_part(after, "02.09.26 ")
    new_drawing = _drawing_of(after, new_sheet)
    assert added == {new_sheet, _rels_name(new_sheet), new_drawing, _rels_name(new_drawing)}
    # đường nối, printerSettings và ảnh của các sheet cũ vẫn còn nguyên, không nhân bản ảnh
    assert _count(after, b"<xdr:cxnSp") == 2
    assert [n for n in after if n.startswith("xl/printerSettings/")] == \
        [n for n in before if n.startswith("xl/printerSettings/")]
    assert sorted(n for n in after if n.startswith("xl/media/")) == sorted(n for n in before if n.startswith("xl/media/"))


def test_new_sheet_is_inserted_in_date_order_before_non_date_sheets(master):
    excel_service.sync_to_master(_summary("2026-09-02"))
    assert _sheet_names(_parts(master)) == ["Báo cáo TH", "01.09.26 ", "02.09.26 ", "03.09.26", "Sheet1"]

    excel_service.sync_to_master(_summary("2026-09-17"))
    assert _sheet_names(_parts(master)) == ["Báo cáo TH", "01.09.26 ", "02.09.26 ", "03.09.26", "17.09.26 ", "Sheet1"]

    excel_service.sync_to_master(_summary("2026-08-30"))
    parts = _assert_valid_package(master)
    assert _sheet_names(parts) == ["Báo cáo TH", "30.08.26 ", "01.09.26 ", "02.09.26 ", "03.09.26",
                                   "17.09.26 ", "Sheet1"]


def test_insert_shifts_active_tab_and_local_defined_names(master):
    excel_service.sync_to_master(_summary("2026-09-02"))
    parts = _assert_valid_package(master)

    wb = ET.fromstring(parts["xl/workbook.xml"])
    view = wb.find(f"{{{MAIN_NS}}}bookViews/{{{MAIN_NS}}}workbookView")
    names = _sheet_names(parts)
    assert names[int(view.get("activeTab"))] == "03.09.26"
    local = {dn.text: names[int(dn.get("localSheetId"))]
             for dn in wb.iter(f"{{{MAIN_NS}}}definedName") if dn.get("localSheetId") is not None}
    assert local == {"'03.09.26'!$A$1:$L$45": "03.09.26", "Sheet1!$A$1:$C$5": "Sheet1"}
    calc_pr = wb.find(f"{{{MAIN_NS}}}calcPr")
    assert calc_pr.get("fullCalcOnLoad") == "1"


def test_new_sheet_reuses_logo_and_footer_images_of_latest_day_sheet(master):
    before = _parts(master)
    source_pictures = _pictures(before, _drawing_of(before, _sheet_part(before, "03.09.26")))
    assert len(source_pictures) == 2

    excel_service.sync_to_master(_summary("2026-09-17"))
    after = _parts(master)
    new_drawing = _drawing_of(after, _sheet_part(after, "17.09.26 "))
    assert _pictures(after, new_drawing) == source_pictures
    anchors = ET.fromstring(after[new_drawing])
    rows = [int(a.find(f"{{{XDR_NS}}}from/{{{XDR_NS}}}row").text) for a in anchors]
    assert rows == [0, 43]
    assert b"cxnSp" not in after[new_drawing]


def test_new_sheet_content_styles_and_page_setup(master, tmp_path):
    summary = _summary("2026-09-17", suggestions="=> chuyển kho")
    excel_service.sync_to_master(summary)
    report = excel_service.generate_excel_report(summary, str(tmp_path / "day.xlsx"))

    synced = openpyxl.load_workbook(master)["17.09.26 "]
    expected = openpyxl.load_workbook(report).active
    for row in expected.iter_rows(min_row=1, max_row=45, max_col=12):
        for cell in row:
            got = synced[cell.coordinate]
            assert got.value == cell.value, cell.coordinate
            if cell.value is not None:
                assert got.data_type == cell.data_type, cell.coordinate
                assert got.font.b == cell.font.b, cell.coordinate
                assert got.font.sz == cell.font.sz, cell.coordinate
                assert got.alignment.horizontal == cell.alignment.horizontal, cell.coordinate
                assert got.alignment.wrap_text == cell.alignment.wrap_text, cell.coordinate
                assert got.border.left.style == cell.border.left.style, cell.coordinate
    assert synced["I11"].value == "=G11/E11*100"
    assert synced["A37"].value == "=> chuyển kho" and synced["A37"].data_type == "s"
    assert {str(r) for r in synced.merged_cells.ranges} == {str(r) for r in expected.merged_cells.ranges}
    assert synced.column_dimensions["B"].width == expected.column_dimensions["B"].width
    assert int(synced.page_setup.paperSize) == 9
    assert synced.sheet_properties.pageSetUpPr.fitToPage


def test_resync_same_date_replaces_sheet_in_place_without_growth(master):
    excel_service.sync_to_master(_summary("2026-09-02"))
    first = _parts(master)
    excel_service.sync_to_master(_summary("2026-09-02", suggestions="Lần 2"))
    second = _assert_valid_package(master)

    assert _sheet_names(second) == _sheet_names(first)
    assert len(second) == len(first)
    assert {n for n in second if not n.startswith(("xl/worksheets/", "xl/drawings/"))} ==         {n for n in first if not n.startswith(("xl/worksheets/", "xl/drawings/"))}
    assert len(second["xl/styles.xml"]) == len(first["xl/styles.xml"])
    assert openpyxl.load_workbook(master)["02.09.26 "]["A37"].value == "Lần 2"
    sheet_id = dict((n, i) for n, i, _ in _sheets(first))["02.09.26 "]
    assert dict((n, i) for n, i, _ in _sheets(second))["02.09.26 "] == sheet_id


def test_resync_of_hand_made_sheet_keeps_name_position_and_removes_only_its_own_parts(master):
    before = _parts(master)
    old_part = _sheet_part(before, "03.09.26")
    old_drawing = _drawing_of(before, old_part)
    old_printer = next(t for typ, t, _ in _rels(before, old_part).values() if typ == "printerSettings")
    other_drawing = _drawing_of(before, _sheet_part(before, "01.09.26 "))

    result = excel_service.sync_to_master(_summary("2026-09-03"))
    after = _assert_valid_package(master)

    assert result["sheet_name"] == "03.09.26"
    assert _sheet_names(after) == _sheet_names(before)
    new_part = _sheet_part(after, "03.09.26")
    replaced = openpyxl.load_workbook(master)["03.09.26"]
    assert "03 / 09 / 2026" in replaced["J4"].value
    assert replaced["A11"].value == "D25" and replaced["E11"].value == 1000
    assert old_printer not in after
    assert (old_drawing not in after) or _drawing_of(after, new_part) == old_drawing
    assert after[other_drawing] == before[other_drawing]
    assert _count(after, b"<xdr:cxnSp") == 2
    for picture in _pictures(after, _drawing_of(after, new_part)):
        assert picture in after
    # sheet được chọn vẫn là 03.09.26 và vẫn chỉ có đúng 1 tab được chọn (đã kiểm trong _assert_valid_package)
    wb = ET.fromstring(after["xl/workbook.xml"])
    view = wb.find(f"{{{MAIN_NS}}}bookViews/{{{MAIN_NS}}}workbookView")
    assert _sheet_names(after)[int(view.get("activeTab"))] == "03.09.26"


def test_trailing_spaces_are_ignored_when_matching_existing_sheet(master):
    excel_service.sync_to_master(_summary("2026-09-01"))
    parts = _assert_valid_package(master)
    assert _sheet_names(parts) == ["Báo cáo TH", "01.09.26 ", "03.09.26", "Sheet1"]


def test_app_properties_list_the_new_sheet(master):
    excel_service.sync_to_master(_summary("2026-09-02"))
    app = ET.fromstring(_parts(master)["docProps/app.xml"])
    ep = "{http://schemas.openxmlformats.org/officeDocument/2006/extended-properties}"
    vt = "{http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes}"

    pairs = app.find(f"{ep}HeadingPairs/{vt}vector")
    values = [(v.find(f"{vt}lpstr").text if v.find(f"{vt}lpstr") is not None else int(v.find(f"{vt}i4").text))
              for v in pairs]
    assert values == ["Worksheets", 5, "Named Ranges", 3]
    titles = app.find(f"{ep}TitlesOfParts/{vt}vector")
    assert titles.get("size") == "8"
    assert [t.text for t in titles] == ["Báo cáo TH", "01.09.26 ", "02.09.26 ", "03.09.26", "Sheet1",
                                        "'03.09.26'!Print_Area", "Sheet1!Print_Area", "TongKL"]


def test_many_syncs_in_a_row_keep_package_valid_and_media_stable(master):
    before = _parts(master)
    for date in ("2026-09-02", "2026-09-04", "2026-09-02", "2026-09-03", "2026-08-31", "2026-09-04"):
        excel_service.sync_to_master(_summary(date))
        parts = _assert_valid_package(master)
    assert sorted(n for n in parts if n.startswith("xl/media/")) == sorted(n for n in before if n.startswith("xl/media/"))
    assert _count(parts, b"<xdr:cxnSp") == 2
    wb = openpyxl.load_workbook(master)
    assert wb.sheetnames == ["Báo cáo TH", "31.08.26 ", "01.09.26 ", "02.09.26 ", "03.09.26", "04.09.26 ", "Sheet1"]


def test_sync_into_openpyxl_made_master_with_absolute_targets(tmp_path, monkeypatch):
    wb = openpyxl.Workbook()
    wb.active.title = "01.09.26 "
    wb.create_sheet("Sheet1")
    path = tmp_path / "m.xlsx"
    wb.save(path)
    monkeypatch.setattr(excel_service, "MASTER_PATH", str(path))
    monkeypatch.setattr(excel_service, "BACKUP_DIR", str(tmp_path / "backups"))

    excel_service.sync_to_master(_summary("2026-09-02"))
    excel_service.sync_to_master(_summary("2026-09-02"))
    parts = _assert_valid_package(path, require_selected_tab=False)
    assert _sheet_names(parts) == ["01.09.26 ", "02.09.26 ", "Sheet1"]


def _convert_to_shared_strings(path):
    """Biến các ô chuỗi nội tuyến của file ngày thành chuỗi dùng chung (như các bản openpyxl/Excel khác ghi)."""
    with zipfile.ZipFile(path) as z:
        parts = {name: z.read(name) for name in z.namelist()}
    sheet = parts["xl/worksheets/sheet1.xml"].decode("utf-8")
    strings = []

    def to_shared(match):
        strings.append(match.group(2))
        return f'{match.group(1)}t="s"><v>{len(strings) - 1}</v></c>'

    sheet = re.sub(r'(<c [^>]*?)t="inlineStr"><is>(.*?)</is></c>', to_shared, sheet, flags=re.S)
    assert strings and "inlineStr" not in sheet
    parts["xl/worksheets/sheet1.xml"] = sheet.encode("utf-8")
    parts["xl/sharedStrings.xml"] = (
        f'<sst xmlns="{MAIN_NS}" count="{len(strings)}" uniqueCount="{len(strings)}">'
        + "".join(f"<si>{s}</si>" for s in strings) + "</sst>").encode("utf-8")
    parts["xl/_rels/workbook.xml.rels"] = parts["xl/_rels/workbook.xml.rels"].replace(
        b"</Relationships>",
        b'<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
        b'sharedStrings" Target="sharedStrings.xml"/></Relationships>')
    parts["[Content_Types].xml"] = parts["[Content_Types].xml"].replace(
        b"</Types>",
        b'<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.'
        b'spreadsheetml.sharedStrings+xml"/></Types>')
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            z.writestr(name, data)


def test_day_report_written_with_shared_strings_is_injected_as_inline_text(master, monkeypatch):
    real_generate = excel_service.generate_excel_report

    def shared_string_generate(summary, output_path=None):
        path = real_generate(summary, output_path)
        _convert_to_shared_strings(path)
        return path

    monkeypatch.setattr(excel_service, "generate_excel_report", shared_string_generate)
    before_sst = _parts(master)["xl/sharedStrings.xml"]
    excel_service.sync_to_master(_summary("2026-09-02", suggestions="  Đề xuất <có> & ký tự đặc biệt\nxuống dòng"))

    parts = _assert_valid_package(master)
    assert parts["xl/sharedStrings.xml"] == before_sst
    assert b't="s"' not in parts[_sheet_part(parts, "02.09.26 ")]
    ws = openpyxl.load_workbook(master)["02.09.26 "]
    assert ws["A37"].value == "  Đề xuất <có> & ký tự đặc biệt\nxuống dòng"
    assert ws["C1"].value == "CÔNG TY TNHH THẮNG LỢI"
    assert ws["A11"].value == "D25"


# ---------------------------------------------------------------- Bug 3: đồng thời, khóa file, ghi nguyên tử

def test_second_sync_while_one_is_running_gets_busy_error(master, monkeypatch):
    started, release = threading.Event(), threading.Event()
    real_generate = excel_service.generate_excel_report
    calls = []

    def slow_generate(summary, output_path=None):
        calls.append(summary["report_date"])
        started.set()
        release.wait(5)
        return real_generate(summary, output_path)

    monkeypatch.setattr(excel_service, "generate_excel_report", slow_generate)
    outcome = {}

    def first_sync():
        try:
            outcome["result"] = excel_service.sync_to_master(_summary("2026-09-02"))
        except Exception as exc:  # pragma: no cover - chỉ để báo lỗi rõ ràng
            outcome["error"] = exc

    worker = threading.Thread(target=first_sync)
    worker.start()
    assert started.wait(5)
    try:
        with pytest.raises(excel_service.MasterFileBusyError) as info:
            excel_service.sync_to_master(_summary("2026-09-04"))
        assert "Đang có một lần đồng bộ khác chạy" in str(info.value)
    finally:
        release.set()
        worker.join(30)
    assert "error" not in outcome, outcome.get("error")
    assert outcome["result"]["status"] == "success"
    assert calls == ["2026-09-02"]
    parts = _assert_valid_package(master)
    assert "02.09.26 " in _sheet_names(parts) and "04.09.26 " not in _sheet_names(parts)
    # khóa đã được nhả: lần đồng bộ tiếp theo chạy bình thường
    excel_service.sync_to_master(_summary("2026-09-04"))


def test_write_locked_master_is_reported_before_any_backup(master, monkeypatch):
    monkeypatch.setattr(excel_service, "_is_write_locked", lambda path: True)
    before = master.read_bytes()

    with pytest.raises(excel_service.MasterFileLockedError) as info:
        excel_service.sync_to_master(_summary())

    assert "đang được mở" in str(info.value)
    assert master.read_bytes() == before
    assert not os.path.exists(excel_service.BACKUP_DIR) or os.listdir(excel_service.BACKUP_DIR) == []
    assert _leftovers(master.parent) == []


@pytest.mark.skipif(sys.platform != "win32", reason="Khóa chia sẻ file kiểu Excel chỉ có trên Windows")
def test_master_opened_with_deny_write_share_mode_is_detected(master):
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateFileW.restype = wintypes.HANDLE
    kernel32.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
                                     wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    GENERIC_READ, FILE_SHARE_READ, OPEN_EXISTING = 0x80000000, 0x1, 3
    handle = kernel32.CreateFileW(str(master), GENERIC_READ, FILE_SHARE_READ, None, OPEN_EXISTING, 0, None)
    assert handle not in (None, wintypes.HANDLE(-1).value)
    before = master.read_bytes()
    try:
        with pytest.raises(excel_service.MasterFileLockedError):
            excel_service.sync_to_master(_summary())
    finally:
        kernel32.CloseHandle(handle)
    assert master.read_bytes() == before
    assert not os.path.exists(excel_service.BACKUP_DIR) or os.listdir(excel_service.BACKUP_DIR) == []
    excel_service.sync_to_master(_summary())  # hết khóa thì đồng bộ được


def test_failed_replace_keeps_master_intact_and_leaves_no_temp_files(master, monkeypatch):
    before = master.read_bytes()
    created = []
    real_generate = excel_service.generate_excel_report

    def spy_generate(summary, output_path=None):
        path = real_generate(summary, output_path)
        created.append(path)
        return path

    def refuse_replace(src, dst):
        raise PermissionError(13, "Access is denied")

    monkeypatch.setattr(excel_service, "generate_excel_report", spy_generate)
    monkeypatch.setattr(excel_service.os, "replace", refuse_replace)
    monkeypatch.setattr(excel_service, "_REPLACE_RETRY_DELAYS", (0, 0), raising=False)

    with pytest.raises(excel_service.MasterSyncError):
        excel_service.sync_to_master(_summary())

    assert master.read_bytes() == before
    assert _leftovers(master.parent) == []
    assert created and not any(os.path.exists(p) for p in created)


def test_sync_never_writes_temp_files_into_the_project_directory(master, monkeypatch):
    project_dir = os.path.dirname(os.path.abspath(excel_service.__file__))
    seen = []
    real_generate = excel_service.generate_excel_report

    def spy_generate(summary, output_path=None):
        seen.append(output_path)
        return real_generate(summary, output_path)

    monkeypatch.setattr(excel_service, "generate_excel_report", spy_generate)
    excel_service.sync_to_master(_summary())

    assert seen and seen[0] is not None
    assert not os.path.abspath(seen[0]).startswith(project_dir + os.sep)
    assert not os.path.exists(seen[0])
    assert _leftovers(master.parent) == []


def test_backup_is_created_for_each_successful_sync(master):
    excel_service.sync_to_master(_summary())
    backups = os.listdir(excel_service.BACKUP_DIR)
    assert len(backups) == 1
    assert zipfile.ZipFile(os.path.join(excel_service.BACKUP_DIR, backups[0])).read("xl/workbook.xml") == \
        zipfile.ZipFile(FIXTURE).read("xl/workbook.xml")


# ---------------------------------------------------------------- API

def test_sync_to_master_returns_400_when_master_file_missing(client, tmp_path, monkeypatch):
    monkeypatch.setattr(excel_service, "MASTER_PATH", str(tmp_path / "missing.xlsx"))
    client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    client.post("/api/shifts", json={"report_date": "2026-09-17", "shift_num": 1})

    resp = client.post("/api/sync-to-master", params={"date": "2026-09-17"})

    assert resp.status_code == 400
    assert "BÁO CÁO TỔNG HỢP" in resp.json()["detail"]
