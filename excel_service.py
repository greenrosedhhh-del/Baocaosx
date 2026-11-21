"""
VICO Production Report - Excel Generation & Synchronization Service
Handles populating the standard VICO daily report template and syncing into master workbook.

Đồng bộ vào file gốc KHÔNG nạp/lưu file gốc bằng openpyxl (openpyxl làm mất đường nối, printerSettings,
nhân bản ảnh...). Sheet ngày được tạo bằng openpyxl trong một workbook tạm, rồi được "tiêm" vào file gốc
ở mức zip/XML; mọi part khác của file gốc được giữ nguyên từng byte.
"""
import html
import math
import os
import posixpath
import re
import shutil
import tempfile
import threading
import time
import zipfile
import xml.etree.ElementTree as ET
from copy import copy
from datetime import date, datetime
from urllib.parse import unquote

import openpyxl
from openpyxl.cell.cell import MergedCell
from openpyxl.cell.rich_text import CellRichText, TextBlock
from openpyxl.cell.text import InlineFont
from openpyxl.drawing.image import Image as OpenpyxlImage
from openpyxl.styles import Alignment, Border, Font, Side
from openpyxl.utils.cell import range_boundaries
from openpyxl.worksheet.page import PageMargins
from openpyxl.worksheet.properties import PageSetupProperties

RED_FONT_COLOR = "FF0000"

# Định dạng số: dấu chấm phân cách hàng nghìn, 2 chữ số thập phân cho tỷ lệ
NUM_FMT_THOUSANDS = '#,##0'
NUM_FMT_PERCENT_2DP = '0.00'


def _apply_red_font(cell) -> None:
    if cell.font:
        f = copy(cell.font)
        f.color = RED_FONT_COLOR
        cell.font = f


def _attach_default_images(ws) -> None:
    """Chèn chữ ký GĐ Nhà máy mặc định tại B44 và logo VICO tại A1."""
    if os.path.exists(LOGO_PATH):
        try:
            logo = OpenpyxlImage(LOGO_PATH)
            logo.width = 110
            logo.height = 70
            ws.add_image(logo, "A1")
        except Exception:
            pass

    if os.path.exists(SIGNATURE_PATH):
        try:
            sig = OpenpyxlImage(SIGNATURE_PATH)
            sig.width = 105
            sig.height = 85
            ws.add_image(sig, "B44")
        except Exception:
            pass


TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), "template_report.xlsx")
SIGNATURE_PATH = os.path.join(os.path.dirname(__file__), "assets", "signature_gd.png")
LOGO_PATH = os.path.join(os.path.dirname(__file__), "assets", "vico_logo.png")
MASTER_PATH = os.environ.get(
    "VICO_MASTER_PATH",
    os.path.join(os.path.dirname(__file__), "BÁO CÁO TỔNG HỢP HÀNG NGÀY.xlsx"),
)


def get_master_path() -> str:
    return os.environ.get("VICO_MASTER_PATH", MASTER_PATH)


BACKUP_DIR = os.path.join(os.path.dirname(get_master_path()), "backups")

# Số dòng dữ liệu cố định của từng mục trong mẫu báo cáo
ROW_LIMITS = {"packaging": 4, "baskets": 4, "tumbling": 6}
MERGED_ROW_LABEL = "Khác"


class MasterSyncError(Exception):
    """Lỗi có thể báo cho người dùng khi đồng bộ file gốc (thông điệp tiếng Việt)."""


class MasterFileBusyError(MasterSyncError):
    """Đang có một lần đồng bộ khác chạy."""


class MasterFileLockedError(MasterSyncError):
    """File gốc đang bị khóa (ví dụ đang mở trong Excel)."""


BACKUP_PREFIX = "BAO_CAO_TONG_HOP_backup_"
MAX_BACKUPS = 10

BUSY_MESSAGE = "Đang có một lần đồng bộ khác chạy, vui lòng thử lại sau ít phút."
LOCKED_MESSAGE = "File BÁO CÁO TỔNG HỢP đang được mở (ví dụ trong Excel). Hãy đóng file rồi thử lại."
CHANGED_MESSAGE = "File BÁO CÁO TỔNG HỢP vừa bị thay đổi trong lúc đồng bộ, vui lòng thử lại."
UNSUPPORTED_MESSAGE = "Không đọc được cấu trúc file BÁO CÁO TỔNG HỢP, file gốc chưa bị thay đổi."

# Khóa trong tiến trình: chỉ một lần đồng bộ được chạy tại một thời điểm
_SYNC_LOCK = threading.Lock()
# Thời gian chờ giữa các lần thử thay file gốc (antivirus/Explorer có thể giữ file trong chốc lát)
_REPLACE_RETRY_DELAYS = (0.2, 0.5, 1.0)

# Ký tự XML 1.0 không cho phép (openpyxl chặn C0; U+FFFE/U+FFFF và surrogate lẻ làm hỏng file)
_ILLEGAL_XML_CHARS_RE = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]")
# Chuỗi người dùng bắt đầu bằng các ký tự này có thể bị Excel hiểu là công thức
_FORMULA_TRIGGERS = ("=", "+", "-", "@")

SHIFT_TIME_LINES = (
    "Thời gian làm việc của Ca 1 từ :   19h30 - 3h30 ",
    "Thời gian làm việc của Ca 2 từ :  3h00 - 11h00 ",
    "Thời gian làm việc của Ca 3 từ :  11h00 - 19h30 ",
)


def _num(value) -> float:
    return value or 0


def _merged_names(items: list) -> str:
    names = [f"{it.get('product_name') or '?'} {it.get('customer') or ''}".strip() for it in items]
    return "Gộp: " + ", ".join(names)


def _fit_rows(items: list, max_rows: int, merge) -> list:
    """Mẫu báo cáo có số dòng cố định: nếu dư thì gộp các dòng cuối thành 1 dòng 'Khác'
    để tổng số liệu trong file Excel vẫn đầy đủ."""
    if len(items) <= max_rows:
        return list(items)
    keep = max_rows - 1
    return list(items[:keep]) + [merge(items[keep:])]


def _merge_packaging(items: list) -> dict:
    return {
        "product_name": MERGED_ROW_LABEL, "customer": "", "from_val": "", "to_val": "",
        "weight_sorted": sum(_num(it.get("weight_sorted")) for it in items),
        "weight_waste": sum(_num(it.get("weight_waste")) for it in items),
        "notes": _merged_names(items),
    }


def _merge_baskets(items: list) -> dict:
    return {
        "product_name": MERGED_ROW_LABEL, "customer": "", "from_val": "", "to_val": "", "steel_grade": "",
        "basket_count": sum(_num(it.get("basket_count")) for it in items),
        "total_weight": sum(
            it["total_weight"] if it.get("total_weight") is not None else _num(it.get("basket_count")) * 350
            for it in items
        ),
        "notes": _merged_names(items),
    }


def _merge_tumbling(items: list) -> dict:
    return {
        "product_name": MERGED_ROW_LABEL, "customer": "",
        "m1": sum(_num(it.get("m1")) for it in items),
        "m2": sum(_num(it.get("m2")) for it in items),
        "total_weight": sum(_num(it.get("total_weight")) for it in items),
        "notes": _merged_names(items),
    }


def clean_text(value: str) -> str:
    """Bỏ các ký tự mà file .xlsx không chứa được (dữ liệu cũ trong DB có thể có)."""
    return _ILLEGAL_XML_CHARS_RE.sub("", value)


def _anchor_cell(ws, row: int, col: int):
    """Ô thực sự chứa giá trị: nếu (row, col) nằm trong vùng gộp thì trả về ô trên-trái của vùng."""
    cell = ws.cell(row=row, column=col)
    if isinstance(cell, MergedCell):
        for rng in ws.merged_cells.ranges:
            if cell.coordinate in rng:
                return ws.cell(row=rng.min_row, column=rng.min_col)
    return cell


def set_cell(ws, row: int, col: int, val, red: bool = False, number_format: str = None):
    """Ghi dữ liệu (kể cả khi ô nằm trong vùng gộp). Chuỗi luôn được lưu dạng văn bản:
    bỏ ký tự điều khiển và không bao giờ trở thành công thức (chống chèn công thức)."""
    cell = _anchor_cell(ws, row, col)
    if red:
        _apply_red_font(cell)
    if isinstance(val, str):
        text = clean_text(val)
        if text == "":
            cell.value = None
            return
        cell.value = text
        cell.data_type = "s"
        if text.startswith(_FORMULA_TRIGGERS):
            cell.quotePrefix = True  # Excel giữ là văn bản kể cả khi người dùng sửa ô
    else:
        cell.value = val
    if number_format:
        cell.number_format = number_format


def set_formula(ws, row: int, col: int, formula: str, red: bool = False):
    """Chỉ dùng cho công thức do chính chương trình tạo (không chứa dữ liệu người dùng)."""
    if not formula.startswith("="):
        raise ValueError("formula must start with '='")
    cell = _anchor_cell(ws, row, col)
    if red:
        _apply_red_font(cell)
    cell.value = formula


def _merge_range(ws, cell_range: str) -> None:
    """Gộp vùng ô, gỡ các vùng gộp cũ giao với nó trước (vd. J44:L44 -> I44:L44)."""
    min_col, min_row, max_col, max_row = range_boundaries(cell_range)
    for rng in list(ws.merged_cells.ranges):
        if rng.min_row <= max_row and rng.max_row >= min_row and rng.min_col <= max_col and rng.max_col >= min_col:
            ws.unmerge_cells(str(rng))
    ws.merge_cells(cell_range)


def _checkbox_text(label: str, failed_shifts) -> str:
    if not failed_shifts:
        return f"☑ {label}"
    shifts = ", ".join(str(s) for s in dict.fromkeys(failed_shifts))
    return f"☐ {label} (Ca {shifts}: không đạt)"


def format_sheet_name(date_str: str) -> str:
    """Converts '2026-09-14' or '14/09/2026' to '14.09.26 '"""
    dt = _parse_report_date(date_str)
    return f"{dt.day:02d}.{dt.month:02d}.{str(dt.year)[2:]} "


def _parse_report_date(date_str: str) -> datetime:
    if "-" in date_str:
        return datetime.strptime(date_str, "%Y-%m-%d")
    return datetime.strptime(date_str, "%d/%m/%Y")


def generate_excel_report(summary_data: dict, output_path: str = None) -> str:
    """
    Generates a single-sheet Excel workbook from summary_data.
    Returns the file path of generated xlsx. Không truyền output_path thì ghi ra một file tạm
    duy nhất (thư mục tạm của hệ thống) — người gọi chịu trách nhiệm xóa.
    """
    if not os.path.exists(TEMPLATE_PATH):
        raise FileNotFoundError(f"Template file not found: {TEMPLATE_PATH}")

    wb = openpyxl.load_workbook(TEMPLATE_PATH)
    ws = wb[wb.sheetnames[0]]

    date_str = summary_data.get("report_date", datetime.now().strftime("%Y-%m-%d"))
    dt = _parse_report_date(date_str)
    ws.title = format_sheet_name(date_str).strip()

    # 1. Header: Date (J4), Ca (A6), an toàn (D7, J7)
    date_display = f"{dt.day:02d} / {dt.month:02d} / {dt.year}"
    cell_j4 = _anchor_cell(ws, 4, 10)
    font_j4 = cell_j4.font.name if cell_j4.font else "Times New Roman"
    sz_j4 = cell_j4.font.size if cell_j4.font else 11
    cell_j4.value = CellRichText(
        " Ngày lập :     ",
        TextBlock(InlineFont(color=RED_FONT_COLOR, rFont=font_j4, sz=sz_j4), clean_text(date_display))
    )
    submitted_shifts = summary_data.get("submitted_shifts")
    if submitted_shifts:
        set_cell(ws, 6, 1, "Ca: " + ", ".join(str(s) for s in submitted_shifts))
    safety = summary_data.get("safety")
    if isinstance(safety, dict):
        if safety.get("production_failed_shifts") is not None:
            set_cell(ws, 7, 1, _checkbox_text("Điều kiện sản xuất", safety["production_failed_shifts"]))
        if safety.get("ppe_failed_shifts") is not None:
            set_cell(ws, 7, 4, _checkbox_text("Bảo hộ đầy đủ", safety["ppe_failed_shifts"]))
        if safety.get("equip_failed_shifts") is not None:
            set_cell(ws, 7, 10, _checkbox_text("Thiết bị an toàn", safety["equip_failed_shifts"]))

    # 2. Chấm công
    attendance = summary_data.get("attendance", {})
    total_staff = attendance.get("total_staff", 5)
    present = attendance.get("present", 5)
    leave_notes = attendance.get("leave_notes", "Ko")
    leave_detail = attendance.get("leave_detail", "")
    unpermitted = attendance.get("unpermitted", "Ko")

    cell_k10 = _anchor_cell(ws, 10, 11)
    font_name = cell_k10.font.name if cell_k10.font else "Times New Roman"
    sz = cell_k10.font.size if cell_k10.font else 11
    cell_k10.value = CellRichText(
        "Tổng sĩ số: ___",
        TextBlock(InlineFont(color=RED_FONT_COLOR, rFont=font_name, sz=sz), clean_text(str(total_staff))),
        "___"
    )

    cell_k11 = _anchor_cell(ws, 11, 11)
    cell_k11.value = CellRichText(
        "Có mặt: __",
        TextBlock(InlineFont(color=RED_FONT_COLOR, rFont=font_name, sz=sz), clean_text(str(present))),
        "__"
    )

    _merge_range(ws, "K13:L13")
    cell_k13 = _anchor_cell(ws, 13, 11)
    leave_str = clean_text(str(leave_notes if leave_notes else "Ko"))
    cell_k13.value = CellRichText(
        "1. Nghỉ phép: ",
        TextBlock(InlineFont(color=RED_FONT_COLOR, rFont=font_name, sz=9), leave_str)
    )
    cell_k13.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
    # Tăng chiều cao nếu nội dung quá dài (>24 ký tự ≈ 2 dòng)
    if len(leave_str) > 10:
        need_h = max(18, 13 * math.ceil((15 + len(leave_str)) / 24) + 4)
        ws.row_dimensions[13].height = max(ws.row_dimensions[13].height or 18, need_h)
    if leave_detail:
        _merge_range(ws, "K17:L17")
        set_cell(ws, 17, 11, leave_detail, red=True)
        ws.cell(17, 11).alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
        ws.cell(17, 11).font = Font(name=font_name, size=9, color=RED_FONT_COLOR)
        if len(leave_detail) > 24:
            need_h = max(18, 13 * math.ceil(len(leave_detail) / 24) + 4)
            ws.row_dimensions[17].height = max(ws.row_dimensions[17].height or 18, need_h)

    cell_k18 = _anchor_cell(ws, 18, 11)
    unpermitted_clean = clean_text(str(unpermitted or "Ko")) or "Ko"
    cell_k18.value = CellRichText(
        "2. Nghỉ không phép: ",
        TextBlock(InlineFont(color=RED_FONT_COLOR, rFont=font_name, sz=9), unpermitted_clean)
    )
    cell_k18.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)

    # 3. Mục 1: BAO GÓI SẢN PHẨM (Row 11 to 14)
    packaging_items = _fit_rows(summary_data.get("packaging", []), ROW_LIMITS["packaging"], _merge_packaging)
    for idx, item in enumerate(packaging_items):
        r = 11 + idx
        set_cell(ws, r, 1, item.get("product_name", ""), red=True)
        set_cell(ws, r, 2, item.get("customer", ""), red=True)
        set_cell(ws, r, 3, item.get("from_val", ""), red=True)
        set_cell(ws, r, 4, item.get("to_val", ""), red=True)
        weight_sorted = item.get("weight_sorted")
        weight_waste = item.get("weight_waste")

        set_cell(ws, r, 5, weight_sorted if weight_sorted is not None else "", red=True, number_format=NUM_FMT_THOUSANDS)
        set_cell(ws, r, 7, weight_waste if weight_waste is not None else "", red=True, number_format=NUM_FMT_THOUSANDS)
        if weight_sorted and weight_waste:
            set_formula(ws, r, 9, f"=G{r}/E{r}*100", red=True)
            _anchor_cell(ws, r, 9).number_format = NUM_FMT_PERCENT_2DP
        elif weight_waste == 0:
            set_cell(ws, r, 9, 0, red=True, number_format=NUM_FMT_PERCENT_2DP)
        set_cell(ws, r, 10, item.get("notes", ""), red=True)

    # Ghi chú thêm bao gói: ghi chú đầu ở hàng 15, các ghi chú còn lại gom vào hàng 16 (không bỏ sót)
    extra_packaging_notes = [n for n in (summary_data.get("packaging_notes") or []) if n]
    if extra_packaging_notes:
        set_cell(ws, 15, 1, extra_packaging_notes[0], red=True)
    rest = extra_packaging_notes[1:]
    if len(rest) == 1:
        set_cell(ws, 16, 1, rest[0], red=True)
    elif rest:
        set_cell(ws, 16, 1, "; ".join(str(note).strip() for note in rest), red=True)

    # 4. Mục 2: SỐ LƯỢNG GIỎ BI RA SAU TÔI (Data starts at Row 21 to 24)
    basket_items = _fit_rows(summary_data.get("baskets", []), ROW_LIMITS["baskets"], _merge_baskets)
    for idx, item in enumerate(basket_items):
        r = 21 + idx
        set_cell(ws, r, 1, item.get("product_name", ""), red=True)
        set_cell(ws, r, 2, item.get("customer", ""), red=True)
        set_cell(ws, r, 3, item.get("from_val", ""), red=True)
        set_cell(ws, r, 4, item.get("to_val", ""), red=True)
        set_cell(ws, r, 5, item.get("steel_grade", ""), red=True)
        basket_count = item.get("basket_count")
        set_cell(ws, r, 7, basket_count if basket_count is not None else "", red=True)
        total_weight = item.get("total_weight")
        if total_weight is not None:
            set_cell(ws, r, 9, total_weight, red=True, number_format=NUM_FMT_THOUSANDS)
        elif basket_count:
            set_formula(ws, r, 9, f"=G{r}*350", red=True)
            _anchor_cell(ws, r, 9).number_format = NUM_FMT_THOUSANDS

    # Ghi chú sau tôi (Row 25). Mẫu không có cột ghi chú cho giỏ bi (I:J là ô gộp
    # "Tổng khối lượng"), nên ghi chú từng dòng được gom xuống dòng ghi chú của mục.
    basket_note_parts = [summary_data.get("basket_notes", "")]
    for item in basket_items:
        notes = (item.get("notes") or "").strip()
        if notes and item.get("product_name") == MERGED_ROW_LABEL:
            basket_note_parts.append(notes)
        elif notes:
            label = f"{item.get('product_name') or ''} {item.get('customer') or ''}".strip()
            basket_note_parts.append(f"{label}: {notes}" if label else notes)
    extra_basket_notes = "; ".join(part for part in basket_note_parts if part)
    if extra_basket_notes:
        set_cell(ws, 25, 1, extra_basket_notes, red=True)

    # 5. Mục 3: SỐ MẺ BI XÓC (Data starts at Row 30 to 35)
    raw_tumbling = list(summary_data.get("tumbling", []))
    def _tmb_sort_key(r):
        prod = str(r.get("product_name") or "")
        parts = [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", prod.strip())]
        return (
            1 if not prod or prod == MERGED_ROW_LABEL else 0,
            parts,
            str(r.get("customer") or "").lower(),
            0 if not r.get("notes") else 1,
            _num(r.get("total_weight")),
            str(r.get("notes") or "")
        )
    raw_tumbling.sort(key=_tmb_sort_key)
    tumbling_items = _fit_rows(raw_tumbling, ROW_LIMITS["tumbling"], _merge_tumbling)

    for idx, item in enumerate(tumbling_items):
        r = 30 + idx
        set_cell(ws, r, 1, item.get("product_name", ""), red=True)
        set_cell(ws, r, 2, item.get("customer", ""), red=True)
        m1 = item.get("m1")
        m2 = item.get("m2")
        set_cell(ws, r, 3, m1 if (m1 is not None and m1 != 0) else "", red=True)
        set_cell(ws, r, 5, m2 if (m2 is not None and m2 != 0) else "", red=True)
        set_cell(ws, r, 7, item.get("total_weight", "") if item.get("total_weight") is not None else "", red=True, number_format=NUM_FMT_THOUSANDS)
        set_cell(ws, r, 9, item.get("notes", ""), red=True)

    # Gộp ô Tên SP (cột A) và Khách hàng (cột B) của các dòng liền kề có cùng sản phẩm & khách hàng
    # để cùng sản phẩm (vd: D40) về 1 khối liền nhau, không bị rời rạc
    i = 0
    while i < len(tumbling_items):
        prod = tumbling_items[i].get("product_name", "")
        cust = tumbling_items[i].get("customer", "")
        j = i + 1
        if prod and prod != MERGED_ROW_LABEL:
            while j < len(tumbling_items) and tumbling_items[j].get("product_name", "") == prod and tumbling_items[j].get("customer", "") == cust:
                j += 1
        start_r = 30 + i
        end_r = 30 + j - 1
        if end_r > start_r:
            _merge_range(ws, f"A{start_r}:A{end_r}")
            _merge_range(ws, f"B{start_r}:B{end_r}")
            set_cell(ws, start_r, 1, prod, red=True)
            set_cell(ws, start_r, 2, cust, red=True)
            ws[f"A{start_r}"].alignment = Alignment(horizontal="center", vertical="center")
            ws[f"B{start_r}"].alignment = Alignment(horizontal="center", vertical="center")
        i = j

    # 6. SỰ CỐ TRONG CA (Cột J-L các hàng 28 đến 35: mỗi sự cố chiếm 1 dòng riêng)
    raw_issues = summary_data.get("issues", [])
    flat_issues = []
    for iss in raw_issues:
        for line in str(iss).split("\n"):
            line_clean = clean_text(line).strip()
            if line_clean:
                if not line_clean.startswith("-"):
                    line_clean = f"- {line_clean}"
                elif not line_clean.startswith("- "):
                    line_clean = f"- {line_clean.lstrip('- ')}"
                flat_issues.append(line_clean)

    MAX_ISSUE_ROWS = 8  # Hàng 28 đến 35 (mỗi dòng tương ứng 1 hàng gộp J:L)
    # Chiều rộng gộp J+K+L ≈ 35 ký tự; dùng cỡ chữ 9 để chứa được nhiều hơn (~42 ký tự/dòng)
    ISSUE_FONT_SIZE = 9
    ISSUE_CHARS_PER_LINE = 42  # ước lượng số ký tự trên 1 dòng ở cỡ 9
    ISSUE_LINE_HEIGHT = 13     # chiều cao (pt) mỗi dòng văn bản ở cỡ 9
    ISSUE_MIN_ROW_HEIGHT = 18  # chiều cao tối thiểu của dòng (pt)

    for offset in range(MAX_ISSUE_ROWS):
        r = 28 + offset
        _merge_range(ws, f"J{r}:L{r}")
        if offset < len(flat_issues):
            if offset == MAX_ISSUE_ROWS - 1 and len(flat_issues) > MAX_ISSUE_ROWS:
                # Nếu vượt quá 8 sự cố, dòng cuối cùng ghép các sự cố còn lại
                val = "; ".join(flat_issues[offset:])
            else:
                val = flat_issues[offset]
            set_cell(ws, r, 10, val, red=True)
            # Tính số dòng wrap và đặt chiều cao phù hợp
            num_lines = max(1, math.ceil(len(val) / ISSUE_CHARS_PER_LINE))
            needed_height = max(ISSUE_MIN_ROW_HEIGHT, ISSUE_LINE_HEIGHT * num_lines + 4)
            current_h = ws.row_dimensions[r].height or ISSUE_MIN_ROW_HEIGHT
            ws.row_dimensions[r].height = max(current_h, needed_height)
        else:
            set_cell(ws, r, 10, None)
        cell_j = ws.cell(r, 10)
        cell_j.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
        cell_j.font = Font(name="Times New Roman", size=ISSUE_FONT_SIZE, color=RED_FONT_COLOR)

    # 7. Yêu cầu - Đề xuất: tiêu đề ở hàng 36, nội dung ngay hàng dưới (A37:H37)
    suggestions = summary_data.get("suggestions", "KO")
    suggestions = clean_text(str(suggestions)) if suggestions else "KO"
    _merge_range(ws, "A37:H37")
    set_cell(ws, 37, 1, suggestions, red=True)
    ws["A37"].alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
    lines = math.ceil(len(suggestions) / 70) if suggestions else 1
    if lines > 1:
        ws.row_dimensions[37].height = max(ws.row_dimensions[37].height or 15, 15 * lines)

    # 8. Thời gian làm việc các ca: thay hẳn 2 nhãn mẫu ở I37/I38, 3 dòng liền nhau ngay dưới tiêu đề
    SHIFT_TIME_DATA = (
        ("Thời gian làm việc của Ca 1 từ :   ", "19h30 - 3h30 "),
        ("Thời gian làm việc của Ca 2 từ :  ", "3h00 - 11h00 "),
        ("Thời gian làm việc của Ca 3 từ :  ", "11h00 - 19h30 "),
    )
    _merge_range(ws, "I39:L39")
    for offset, (label, t_val) in enumerate(SHIFT_TIME_DATA):
        r = 37 + offset
        c_cell = _anchor_cell(ws, r, 9)
        fn = c_cell.font.name if c_cell.font else "Times New Roman"
        sz_time = c_cell.font.size if c_cell.font else 11
        c_cell.value = CellRichText(label, TextBlock(InlineFont(color=RED_FONT_COLOR, rFont=fn, sz=sz_time), t_val))
    ws["I39"].alignment = copy(ws["I38"].alignment)

    # 9. Người báo cáo
    _merge_range(ws, "I44:L44")
    set_cell(ws, 44, 9, "Người báo cáo:")
    reporter_name = summary_data.get("reporter_name", "Ngọc Quang")
    set_cell(ws, 45, 8, f"                              {reporter_name}")

    # 10. In trên 1 trang A4 dọc như các sheet ngày trong file gốc
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.orientation = ws.ORIENTATION_PORTRAIT
    if ws.sheet_properties.pageSetUpPr is None:
        ws.sheet_properties.pageSetUpPr = PageSetupProperties()
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.page_margins = PageMargins(left=0.7, right=0.7, top=0.75, bottom=0.75, header=0.3, footer=0.3)

    # 11. Chèn chữ ký GĐ Nhà máy mặc định và logo
    _attach_default_images(ws)

    created_temp = False
    if not output_path:
        fd, output_path = tempfile.mkstemp(prefix=f"BAO_CAO_{dt.strftime('%Y%m%d')}_", suffix=".xlsx")
        os.close(fd)
        created_temp = True
    try:
        wb.save(output_path)
    except BaseException:
        if created_temp and os.path.exists(output_path):
            os.remove(output_path)
        raise
    return output_path


def backup_master_workbook() -> str:
    """Creates a timestamped copy of MASTER_PATH in backups/"""
    if not os.path.exists(MASTER_PATH):
        return ""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    backup_path = os.path.join(BACKUP_DIR, f"{BACKUP_PREFIX}{timestamp}.xlsx")
    shutil.copy2(MASTER_PATH, backup_path)
    _prune_backups()
    return backup_path


def _prune_backups() -> None:
    """Chỉ giữ MAX_BACKUPS bản sao lưu mới nhất (tên file chứa thời điểm nên sắp xếp theo tên)."""
    backups = sorted(
        f for f in os.listdir(BACKUP_DIR) if f.startswith(BACKUP_PREFIX) and f.endswith(".xlsx")
    )
    for old in backups[:-MAX_BACKUPS]:
        os.remove(os.path.join(BACKUP_DIR, old))


# =====================================================================================
# Đồng bộ vào file gốc
# =====================================================================================

def _is_write_locked(path: str) -> bool:
    """True nếu file đang bị tiến trình khác giữ không cho ghi (vd. Excel đang mở file)."""
    try:
        with open(path, "r+b"):
            return False
    except PermissionError:
        return True


def _remove_quietly(path) -> None:
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass


def sync_to_master(summary_data: dict) -> dict:
    """
    Safely syncs the daily summary into the master file BÁO CÁO TỔNG HỢP HÀNG NGÀY.xlsx
    Returns status and backup information.
    """
    if not _SYNC_LOCK.acquire(blocking=False):
        raise MasterFileBusyError(BUSY_MESSAGE)
    day_report = None
    try:
        master_path = MASTER_PATH
        if not os.path.exists(master_path):
            raise FileNotFoundError(f"Master workbook not found: {master_path}")
        # Kiểm tra khóa TRƯỚC khi sao lưu để không tạo bản sao lưu vô ích mỗi lần thử
        if _is_write_locked(master_path):
            raise MasterFileLockedError(LOCKED_MESSAGE)

        date_str = summary_data.get("report_date", datetime.now().strftime("%Y-%m-%d"))
        sheet_name = format_sheet_name(date_str)

        fd, day_report = tempfile.mkstemp(prefix="vico_day_report_", suffix=".xlsx")
        os.close(fd)
        day_report = generate_excel_report(summary_data, day_report)

        backup_file = backup_master_workbook()
        final_name = _inject_day_sheet(master_path, day_report, sheet_name, _parse_report_date(date_str).date())
        return {
            "status": "success",
            "sheet_name": final_name,
            "backup_file": backup_file,
            "master_path": master_path,
        }
    finally:
        _remove_quietly(day_report)
        _SYNC_LOCK.release()


# ----------------------------------------------------------------- hằng số OOXML

_MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
_XML_NS = "http://www.w3.org/XML/1998/namespace"
_RT_WORKSHEET = _REL_NS + "/worksheet"
_RT_DRAWING = _REL_NS + "/drawing"
_CT_WORKSHEET = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"
_CT_DRAWING = "application/vnd.openxmlformats-officedocument.drawing+xml"
_XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'

_ATTR_RE = re.compile(r'([^\s=/<>"\']+)\s*=\s*(?:"([^"]*)"|\'([^\']*)\')')
_PFX = r"(?:[A-Za-z_][\w.-]*:)?"
_SHEET_DATE_RE = re.compile(r"^\s*(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?!\d)")


def _q(tag: str) -> str:
    return f"{{{_MAIN_NS}}}{tag}"


def _escape_attr(value: str) -> str:
    return (value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
            .replace("\r", "&#13;").replace("\n", "&#10;").replace("\t", "&#9;"))


def _escape_text(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\r", "&#13;")


def _attrs(start_tag: str) -> dict:
    return {m.group(1): html.unescape(m.group(2) if m.group(2) is not None else m.group(3))
            for m in _ATTR_RE.finditer(start_tag)}


def _set_attr(start_tag: str, name: str, value: str) -> str:
    pattern = re.compile(r"(\s" + re.escape(name) + r"\s*=\s*)(\"[^\"]*\"|'[^']*')")
    if pattern.search(start_tag):
        return pattern.sub(lambda m: f'{m.group(1)}"{_escape_attr(value)}"', start_tag, count=1)
    cut = len(start_tag) - (2 if start_tag.endswith("/>") else 1)
    return f'{start_tag[:cut]} {name}="{_escape_attr(value)}"{start_tag[cut:]}'


def _root_prefix(xml_text: str, uri: str):
    """Tiền tố (có dấu ':' hoặc '') mà thẻ gốc khai báo cho namespace uri; None nếu không khai báo."""
    root = re.search(r"<(?![?!])[^>]*>", xml_text).group(0)
    for key, value in _attrs(root).items():
        if value == uri:
            if key == "xmlns":
                return ""
            if key.startswith("xmlns:"):
                return key[6:] + ":"
    return None


def _element_prefix(xml_text: str, local: str) -> str:
    m = re.search(r"<(" + _PFX + ")" + local + r"\b", xml_text)
    return m.group(1) if m else ""


def _serialize(el, prefixes: dict, declare: bool = False) -> str:
    """Ghi phần tử ElementTree ra chuỗi với tiền tố namespace cố định (prefixes: uri -> '' hoặc 'p')."""
    def qname(tag):
        if tag.startswith("{"):
            uri, local = tag[1:].split("}", 1)
            if uri == _XML_NS:
                return "xml:" + local
            prefix = prefixes[uri]
            return f"{prefix}:{local}" if prefix else local
        return tag

    out = []

    def write(node, is_root):
        name = qname(node.tag)
        out.append("<" + name)
        if is_root and declare:
            for uri, prefix in prefixes.items():
                out.append(f' xmlns{":" + prefix if prefix else ""}="{_escape_attr(uri)}"')
        for key, value in node.attrib.items():
            out.append(f' {qname(key)}="{_escape_attr(value)}"')
        if len(node) or node.text:
            out.append(">")
            if node.text:
                out.append(_escape_text(node.text))
            for child in node:
                write(child, False)
                if child.tail:
                    out.append(_escape_text(child.tail))
            out.append(f"</{name}>")
        else:
            out.append("/>")

    write(el, True)
    return "".join(out)


def _rels_part_name(part: str) -> str:
    return posixpath.join(posixpath.dirname(part), "_rels", posixpath.basename(part) + ".rels")


def _resolve_target(source_part: str, target: str) -> str:
    target = unquote(target)
    if target.startswith("/"):
        return posixpath.normpath(target.lstrip("/"))
    return posixpath.normpath(posixpath.join(posixpath.dirname(source_part), target))


def _parse_rels(data: bytes, source_part: str) -> list:
    """[{id, type, target(raw), part(resolved or None), external}]"""
    rels = []
    for rel in ET.fromstring(data).findall(f"{{{_PKG_REL_NS}}}Relationship"):
        external = rel.get("TargetMode") == "External"
        target = rel.get("Target", "")
        rels.append({
            "id": rel.get("Id"), "type": rel.get("Type", ""), "target": target, "external": external,
            "part": None if external else _resolve_target(source_part, target),
        })
    return rels


def _sheet_date(name: str):
    m = _SHEET_DATE_RE.match(name)
    if not m:
        return None
    day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if year < 100:
        year += 2000
    try:
        return date(year, month, day)
    except ValueError:
        return None


# ----------------------------------------------------------------- gộp styles

_BOOL_FONT_ELEMENTS = {"b", "i", "strike", "condense", "extend", "outline", "shadow"}
_XF_BOOL_ATTRS = {"applyNumberFormat", "applyFont", "applyFill", "applyBorder", "applyAlignment",
                  "applyProtection", "quotePrefix", "pivotButton"}


def _canon(el):
    """Khóa so sánh 2 phần tử style tương đương (không phụ thuộc thứ tự thuộc tính/con, cách ghi bool)."""
    local = el.tag.split("}")[-1]
    attrs = {k.split("}")[-1]: v for k, v in el.attrib.items()}
    if local in _BOOL_FONT_ELEMENTS:
        attrs["val"] = "0" if attrs.get("val", "1") in ("0", "false") else "1"
    if local == "u":
        attrs.setdefault("val", "single")
    if local == "xf":
        for key in list(attrs):
            if key in _XF_BOOL_ATTRS:
                if attrs[key] in ("0", "false"):
                    del attrs[key]
                else:
                    attrs[key] = "1"
    return (local, tuple(sorted(attrs.items())), (el.text or "").strip(), tuple(sorted(_canon(c) for c in el)))


class _StyleSection:
    """Một danh sách style trong styles.xml gốc (fonts, fills, borders, cellXfs)."""

    def __init__(self, master_root, local):
        container = master_root.find(_q(local))
        items = list(container) if container is not None else []
        self.count = len(items)
        self.index = {}
        for i, item in enumerate(items):
            self.index.setdefault(_canon(item), i)
        self.new_elements = []

    def add(self, element) -> int:
        key = _canon(element)
        if key not in self.index:
            self.index[key] = self.count + len(self.new_elements)
            self.new_elements.append(element)
        return self.index[key]


def _splice_section(text: str, local: str, fragments: list, total: int, prefix: str, before_local=None) -> str:
    """Thêm các phần tử con vào cuối <local>...</local> và cập nhật count; tạo mới nếu chưa có."""
    if not fragments:
        return text
    start = re.search(r"<" + re.escape(prefix) + local + r"\b[^>]*?(/?)>", text)
    if start is None:
        block = f'<{prefix}{local} count="{total}">{"".join(fragments)}</{prefix}{local}>'
        root = re.search(r"<(?![?!])[^>]*>", text)
        insert_at = root.end()
        if before_local:
            nxt = re.search(r"<" + re.escape(prefix) + before_local + r"\b", text)
            if nxt:
                insert_at = nxt.start()
        return text[:insert_at] + block + text[insert_at:]
    tag = _set_attr(start.group(0), "count", str(total))
    if start.group(1):  # <fonts count="0"/>
        tag = tag[:-2].rstrip() + ">"
        return text[:start.start()] + tag + "".join(fragments) + f"</{prefix}{local}>" + text[start.end():]
    end = text.index(f"</{prefix}{local}>", start.end())
    return text[:start.start()] + tag + text[start.end():end] + "".join(fragments) + text[end:]


def _merge_styles(master_styles: bytes, day_styles: bytes, used_xfs: set):
    """Đưa các định dạng ô mà sheet ngày dùng vào styles.xml gốc.
    Trả về (styles.xml mới, {chỉ số xf ngày: chỉ số xf gốc}). Định dạng đã có sẵn thì dùng lại."""
    master_text = master_styles.decode("utf-8")
    master_root = ET.fromstring(master_styles)
    day_root = ET.fromstring(day_styles)

    def children(root, local):
        node = root.find(_q(local))
        return list(node) if node is not None else []

    sections = {local: _StyleSection(master_root, local) for local in ("fonts", "fills", "borders", "cellXfs")}
    master_numfmts = {nf.get("formatCode"): int(nf.get("numFmtId")) for nf in children(master_root, "numFmts")}
    next_numfmt = max([163] + list(master_numfmts.values())) + 1
    new_numfmts = []
    day_numfmts = {int(nf.get("numFmtId")): nf.get("formatCode") for nf in children(day_root, "numFmts")}
    day_lists = {local: children(day_root, local) for local in ("fonts", "fills", "borders", "cellXfs")}

    def map_numfmt(num_id: int) -> int:
        nonlocal next_numfmt
        if num_id < 164 or num_id not in day_numfmts:
            return num_id
        code = day_numfmts[num_id]
        if code not in master_numfmts:
            master_numfmts[code] = next_numfmt
            element = ET.Element(_q("numFmt"), {"numFmtId": str(next_numfmt), "formatCode": code})
            new_numfmts.append(element)
            next_numfmt += 1
        return master_numfmts[code]

    xf_map = {}
    for day_index in sorted(used_xfs):
        xf = day_lists["cellXfs"][day_index] if day_index < len(day_lists["cellXfs"]) else None
        if xf is None:
            xf_map[day_index] = 0
            continue
        new_xf = ET.Element(_q("xf"), dict(xf.attrib))
        for attr, local in (("fontId", "fonts"), ("fillId", "fills"), ("borderId", "borders")):
            source_index = int(xf.get(attr, "0"))
            source = day_lists[local][source_index] if source_index < len(day_lists[local]) else None
            new_xf.set(attr, str(sections[local].add(source) if source is not None else 0))
        new_xf.set("numFmtId", str(map_numfmt(int(xf.get("numFmtId", "0")))))
        new_xf.set("xfId", "0")
        for child in xf:
            new_xf.append(child)
        xf_map[day_index] = sections["cellXfs"].add(new_xf)

    prefix = _element_prefix(master_text, "styleSheet")
    ns_prefix = prefix[:-1] if prefix else ""
    prefixes = {_MAIN_NS: ns_prefix}
    text = master_text
    if new_numfmts:
        existing = len(children(master_root, "numFmts"))
        text = _splice_section(text, "numFmts", [_serialize(e, prefixes) for e in new_numfmts],
                               existing + len(new_numfmts), prefix, before_local="fonts")
    for local in ("fonts", "fills", "borders", "cellXfs"):
        section = sections[local]
        text = _splice_section(text, local, [_serialize(e, prefixes) for e in section.new_elements],
                               section.count + len(section.new_elements), prefix)
    return text.encode("utf-8"), xf_map


# ----------------------------------------------------------------- sheet & drawing XML

def _read_day_sheet(day_path: str):
    """(sheet root Element, styles.xml bytes, shared strings list) của workbook ngày do openpyxl tạo."""
    with zipfile.ZipFile(day_path) as z:
        names = set(z.namelist())
        workbook_part = next(r["part"] for r in _parse_rels(z.read("_rels/.rels"), "")
                             if r["type"].endswith("/officeDocument"))
        wb_rels = _parse_rels(z.read(_rels_part_name(workbook_part)), workbook_part)
        by_id = {r["id"]: r for r in wb_rels}
        wb_root = ET.fromstring(z.read(workbook_part))
        first_sheet = wb_root.find(_q("sheets"))[0]
        sheet_part = by_id[first_sheet.get(f"{{{_REL_NS}}}id")]["part"]
        styles_part = next(r["part"] for r in wb_rels if r["type"].endswith("/styles"))
        shared = []
        sst_rel = next((r for r in wb_rels if r["type"].endswith("/sharedStrings")), None)
        if sst_rel and sst_rel["part"] in names:
            shared = list(ET.fromstring(z.read(sst_rel["part"])).findall(_q("si")))
        sheet_root = ET.fromstring(z.read(sheet_part))
        # Bỏ phần tử <drawing> mà openpyxl tạo trong sheet ngày tạm;
        # khi tiêm vào master, injector sẽ tự gắn drawing riêng của master.
        for dw in list(sheet_root.findall(_q("drawing"))):
            sheet_root.remove(dw)

        sheet_rels = _rels_part_name(sheet_part)
        if sheet_rels in names:
            other_rels = [r for r in _parse_rels(z.read(sheet_rels), sheet_part) if r["type"] != _RT_DRAWING]
            if other_rels:
                raise RuntimeError("Sheet mẫu có quan hệ (chưa được hỗ trợ) khi đồng bộ")
        return sheet_root, z.read(styles_part), shared


def _used_style_indexes(sheet_root) -> set:
    used = {0}
    for c in sheet_root.iter(_q("c")):
        used.add(int(c.get("s", "0")))
    for row in sheet_root.iter(_q("row")):
        if row.get("s") is not None:
            used.add(int(row.get("s")))
    for col in sheet_root.iter(_q("col")):
        if col.get("style") is not None:
            used.add(int(col.get("style")))
    return used


_WORKSHEET_AFTER_DRAWING = {"legacyDrawing", "legacyDrawingHF", "drawingHF", "picture", "oleObjects",
                            "controls", "webPublishItems", "tableParts", "extLst"}


def _build_sheet_xml(sheet_root, xf_map: dict, shared: list, drawing_rid, tab_selected: bool) -> bytes:
    for el in sheet_root.iter():
        for key in el.attrib:
            if key.startswith(f"{{{_REL_NS}}}"):
                raise RuntimeError("Sheet ngày có tham chiếu quan hệ chưa được hỗ trợ khi đồng bộ")

    for view in sheet_root.iter(_q("sheetView")):
        view.attrib.pop("tabSelected", None)
        if tab_selected:
            view.set("tabSelected", "1")
    for c in sheet_root.iter(_q("c")):
        if c.get("s") is not None:
            c.set("s", str(xf_map.get(int(c.get("s")), 0)))
        value = c.find(_q("v"))
        if c.get("t") == "s":  # chuỗi dùng chung -> chuỗi nội tuyến, không đụng sharedStrings.xml gốc
            si = shared[int(value.text)]
            c.remove(value)
            c.set("t", "inlineStr")
            inline = ET.SubElement(c, _q("is"))
            for child in si:
                inline.append(child)
        elif c.find(_q("f")) is not None and value is not None and not value.text:
            c.remove(value)  # công thức chưa có giá trị: Excel tính lại khi mở (fullCalcOnLoad)
    for row in sheet_root.iter(_q("row")):
        if row.get("s") is not None:
            row.set("s", str(xf_map.get(int(row.get("s")), 0)))
    for col in sheet_root.iter(_q("col")):
        if col.get("style") is not None:
            col.set("style", str(xf_map.get(int(col.get("style")), 0)))

    prefixes = {_MAIN_NS: ""}
    if drawing_rid:
        prefixes[_REL_NS] = "r"
        drawing = ET.Element(_q("drawing"), {f"{{{_REL_NS}}}id": drawing_rid})
        children = list(sheet_root)
        position = next((i for i, child in enumerate(children)
                         if child.tag.split("}")[-1] in _WORKSHEET_AFTER_DRAWING), len(children))
        sheet_root.insert(position, drawing)
    for el in sheet_root.iter():
        for qualified in [el.tag, *el.attrib]:
            uri = qualified[1:].split("}")[0] if qualified.startswith("{") else None
            if uri and uri != _XML_NS and uri not in prefixes:
                prefixes[uri] = f"ns{len(prefixes)}"
    return (_XML_DECL + _serialize(sheet_root, prefixes, declare=True)).encode("utf-8")


def _picture_drawing(drawing_xml: bytes, drawing_rels: list):
    """Từ drawing của một sheet ngày thật, chỉ giữ các ảnh (logo, ảnh cuối trang) — bỏ đường nối,
    hình vẽ tay của ngày đó. Trả về (xml, [quan hệ cần giữ]) hoặc None nếu không có ảnh."""
    text = drawing_xml.decode("utf-8")
    root = re.search(r"<(" + _PFX + r")wsDr\b[^>]*>", text)
    if root is None:
        return None
    p = re.escape(root.group(1))
    end = text.rfind(f"</{root.group(1)}wsDr>")
    if end < 0:
        return None
    body = text[root.end():end]
    body = re.sub(r"<(" + _PFX + r")AlternateContent\b.*?</\1AlternateContent>", "", body, flags=re.S)
    anchors = [m.group(0) for m in re.finditer(
        r"<" + p + r"(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b.*?</" + p + r"\1>", body, flags=re.S)]
    pictures = [a for a in anchors if re.search(r"<" + p + r"pic\b", a)]
    if not pictures:
        return None
    kept = "".join(pictures)
    wanted = set(re.findall(r"\s[A-Za-z_][\w.-]*:(?:embed|link|id|pict)\s*=\s*\"([^\"]*)\"", kept))
    rels = [r for r in drawing_rels if r["id"] in wanted]
    xml = _XML_DECL + root.group(0) + kept + f"</{root.group(1)}wsDr>"
    try:
        ET.fromstring(xml.encode("utf-8"))
    except ET.ParseError:
        return None
    return xml.encode("utf-8"), rels


def _rels_xml(rels: list, source_part: str) -> bytes:
    items = []
    for rel in rels:
        target = rel["target"] if rel["external"] else posixpath.relpath(rel["part"], posixpath.dirname(source_part))
        mode = ' TargetMode="External"' if rel["external"] else ""
        items.append(f'<Relationship Id="{_escape_attr(rel["id"])}" Type="{_escape_attr(rel["type"])}" '
                     f'Target="{_escape_attr(target)}"{mode}/>')
    return (_XML_DECL + f'<Relationships xmlns="{_PKG_REL_NS}">' + "".join(items) + "</Relationships>").encode("utf-8")


# ----------------------------------------------------------------- workbook-level edits

def _workbook_sheets(wb_text: str):
    """([(vị trí bắt đầu, vị trí kết thúc, thuộc tính, thẻ mở)] của các <sheet>, tiền tố của <sheets>,
    vị trí ngay trước </sheets>)."""
    block = re.search(r"<(" + _PFX + r")sheets\b[^>]*>(.*?)</\1sheets>", wb_text, flags=re.S)
    if block is None:
        raise MasterSyncError(UNSUPPORTED_MESSAGE)
    body_start = block.start(2)
    items = []
    for m in re.finditer(r"<" + _PFX + r"sheet\b[^>]*?(?:/>|>.*?</" + _PFX + r"sheet>)", block.group(2), flags=re.S):
        start_tag = re.match(r"<[^>]*>", m.group(0)).group(0)
        items.append((body_start + m.start(), body_start + m.end(), _attrs(start_tag), start_tag))
    return items, block.group(1), block.end(2)


def _sheet_rel_id(attrs: dict, wb_text: str):
    root_attrs = _attrs(re.search(r"<(?![?!])[^>]*>", wb_text).group(0))
    for source in (attrs, root_attrs):
        for key, value in source.items():
            if key.startswith("xmlns:") and value == _REL_NS and f"{key[6:]}:id" in attrs:
                return attrs[f"{key[6:]}:id"]
    return None


def _update_app_titles(app_xml: bytes, old_names: list, new_names: list):
    """Cập nhật danh sách tên sheet trong docProps/app.xml. Trả None nếu cấu trúc không như mong đợi."""
    text = app_xml.decode("utf-8")
    pairs = re.search(r"<(" + _PFX + r")HeadingPairs>(.*?)</\1HeadingPairs>", text, flags=re.S)
    titles = re.search(r"<(" + _PFX + r")TitlesOfParts>(.*?)</\1TitlesOfParts>", text, flags=re.S)
    if not pairs or not titles or pairs.start() > titles.start():
        return None
    variants = list(re.finditer(r"<(" + _PFX + r")(lpstr|i4)>(.*?)</\1\2>", pairs.group(2), flags=re.S))
    title_items = list(re.finditer(r"<(" + _PFX + r")lpstr>(.*?)</\1lpstr>", titles.group(2), flags=re.S))
    offset = 0
    for i in range(0, len(variants) - 1, 2):
        if variants[i].group(2) != "lpstr" or variants[i + 1].group(2) != "i4":
            return None
        count = int(variants[i + 1].group(3))
        chunk = [html.unescape(t.group(2)) for t in title_items[offset:offset + count]]
        if count and count == len(old_names) and chunk == old_names:
            prefix = title_items[0].group(1)
            new_items = "".join(f"<{prefix}lpstr>{_escape_text(n)}</{prefix}lpstr>" for n in new_names)
            start = titles.start(2) + title_items[offset].start()
            end = titles.start(2) + title_items[offset + count - 1].end()
            i4 = variants[i + 1]
            size = len(title_items) - count + len(new_names)
            # TitlesOfParts nằm sau HeadingPairs: sửa phần sau trước để vị trí <vt:i4> trong HeadingPairs vẫn đúng
            new_text = text[:start] + new_items + text[end:]
            vector = re.compile(r"(<" + _PFX + r"TitlesOfParts>\s*<" + _PFX + r"vector\b[^>]*?\ssize=\")(\d+)(\")")
            new_text = vector.sub(lambda m: f"{m.group(1)}{size}{m.group(3)}", new_text, count=1)
            i4_start, i4_end = pairs.start(2) + i4.start(3), pairs.start(2) + i4.end(3)
            new_text = new_text[:i4_start] + str(len(new_names)) + new_text[i4_end:]
            return new_text.encode("utf-8")
        offset += count
    return None


# ----------------------------------------------------------------- injector

def _inject_day_sheet(master_path: str, day_path: str, sheet_name: str, sheet_day: date) -> str:
    """Đưa sheet ngày vào file gốc ở mức zip/XML. Trả về tên sheet trong file gốc."""
    master_stat = os.stat(master_path)
    with zipfile.ZipFile(master_path) as zin:
        infos = zin.infolist()
        names = {i.filename for i in infos}
        read = zin.read
        try:
            plan = _plan_injection(read, names, infos, day_path, sheet_name, sheet_day)
        except (KeyError, ValueError, IndexError, ET.ParseError, StopIteration) as exc:
            raise MasterSyncError(UNSUPPORTED_MESSAGE) from exc
        changed, added, removed, final_name = plan

        master_dir = os.path.dirname(os.path.abspath(master_path))
        fd, tmp_path = tempfile.mkstemp(prefix=".vico_sync_", suffix=".xlsx.tmp", dir=master_dir)
        try:
            with os.fdopen(fd, "wb") as handle, zipfile.ZipFile(handle, "w", zipfile.ZIP_DEFLATED) as zout:
                stamp = infos[0].date_time if infos else (1980, 1, 1, 0, 0, 0)
                for info in infos:
                    if info.filename in removed:
                        continue
                    out_info = zipfile.ZipInfo(info.filename, date_time=info.date_time)
                    out_info.compress_type = info.compress_type
                    out_info.external_attr = info.external_attr
                    data = changed[info.filename] if info.filename in changed else read(info.filename)
                    zout.writestr(out_info, data)
                for name, data in added.items():
                    out_info = zipfile.ZipInfo(name, date_time=stamp)
                    out_info.compress_type = zipfile.ZIP_DEFLATED
                    zout.writestr(out_info, data)
        except BaseException:
            _remove_quietly(tmp_path)
            raise

    try:
        _verify_written(tmp_path, names - removed | set(added), list(changed) + list(added), changed, added)
        current = os.stat(master_path)
        if (current.st_mtime_ns, current.st_size) != (master_stat.st_mtime_ns, master_stat.st_size):
            raise MasterSyncError(CHANGED_MESSAGE)
        try:
            shutil.copymode(master_path, tmp_path)
        except OSError:
            pass
        last_error = None
        for delay in (0,) + tuple(_REPLACE_RETRY_DELAYS):
            if delay:
                time.sleep(delay)
            try:
                os.replace(tmp_path, master_path)
                break
            except PermissionError as exc:
                last_error = exc
        else:
            raise MasterFileLockedError(LOCKED_MESSAGE) from last_error
    finally:
        _remove_quietly(tmp_path)
    return final_name


def _verify_written(path: str, expected_names: set, xml_parts: list, changed: dict, added: dict) -> None:
    """Đọc lại file vừa ghi trước khi thay file gốc: đủ part, các part đã sửa/thêm là XML hợp lệ."""
    try:
        with zipfile.ZipFile(path) as z:
            if set(z.namelist()) != expected_names:
                raise MasterSyncError(UNSUPPORTED_MESSAGE)
            for name in xml_parts:
                data = z.read(name)
                if data != (changed.get(name) if name in changed else added.get(name)):
                    raise MasterSyncError(UNSUPPORTED_MESSAGE)
                if name.endswith((".xml", ".rels")):
                    ET.fromstring(data)
    except (zipfile.BadZipFile, ET.ParseError) as exc:
        raise MasterSyncError(UNSUPPORTED_MESSAGE) from exc


def _plan_injection(read, names: set, infos: list, day_path: str, sheet_name: str, sheet_day: date):
    changed, added = {}, {}

    # --- workbook và quan hệ
    root_rels = _parse_rels(read("_rels/.rels"), "")
    workbook_part = next(r["part"] for r in root_rels if r["type"].endswith("/officeDocument"))
    app_part = next((r["part"] for r in root_rels if r["type"].endswith("/extended-properties")), None)
    wb_rels_part = _rels_part_name(workbook_part)

    all_rels = {}
    for info in infos:
        name = info.filename
        if name.endswith(".rels"):
            owner = posixpath.join(posixpath.dirname(posixpath.dirname(name)), posixpath.basename(name)[:-5])
            all_rels[name] = _parse_rels(read(name), "" if name == "_rels/.rels" else owner)
    wb_rels = all_rels[wb_rels_part]
    rel_by_id = {r["id"]: r for r in wb_rels}

    wb_text = read(workbook_part).decode("utf-8")
    sheet_items, sheets_prefix, sheets_close = _workbook_sheets(wb_text)
    et_sheets = ET.fromstring(wb_text.encode("utf-8")).find(_q("sheets"))
    sheet_names = [attrs.get("name") for _, _, attrs, _ in sheet_items]
    if et_sheets is None or [s.get("name") for s in et_sheets] != sheet_names:
        raise MasterSyncError(UNSUPPORTED_MESSAGE)
    sheet_parts = [rel_by_id[_sheet_rel_id(attrs, wb_text)]["part"] for _, _, attrs, _ in sheet_items]

    views = list(re.finditer(r"<" + _PFX + r"workbookView\b[^>]*>", wb_text))
    active_tab = int(_attrs(views[0].group(0)).get("activeTab", "0")) if views else 0

    # --- sheet cần thay (khớp tên bỏ qua khoảng trắng cuối) hoặc vị trí chèn theo ngày
    replace_index = next((i for i, n in enumerate(sheet_names) if n.rstrip() == sheet_name.rstrip()), None)
    if replace_index is None:
        earlier = [i for i, n in enumerate(sheet_names) if (d := _sheet_date(n)) is not None and d < sheet_day]
        later = [i for i, n in enumerate(sheet_names) if (d := _sheet_date(n)) is not None and d > sheet_day]
        if earlier:
            position = earlier[-1] + 1
        elif later:
            position = later[0]
        else:
            position = len(sheet_names)
        final_name = sheet_name
    else:
        position = replace_index
        final_name = sheet_names[replace_index]

    # --- ảnh logo/cuối trang: lấy từ sheet ngày thật gần nhất có ảnh
    picture_source = None
    dated = sorted(((d, i) for i, n in enumerate(sheet_names) if (d := _sheet_date(n)) is not None), reverse=True)
    for _, index in dated:
        part = sheet_parts[index]
        drawing_rel = next((r for r in all_rels.get(_rels_part_name(part), [])
                            if r["type"] == _RT_DRAWING and r["part"] in names), None)
        if drawing_rel is None:
            continue
        drawing_part = drawing_rel["part"]
        picture_source = _picture_drawing(read(drawing_part), all_rels.get(_rels_part_name(drawing_part), []))
        if picture_source is not None:
            break

    # --- bỏ sheet cũ (nếu thay) và calcChain
    removed = set()
    content_types = read("[Content_Types].xml").decode("utf-8")
    wb_rels_text = read(wb_rels_part).decode("utf-8")

    calc_rels = [r for r in wb_rels if r["type"].endswith("/calcChain")]
    for rel in calc_rels:
        if rel["part"] in names:
            removed.add(rel["part"])
        wb_rels_text = _remove_relationship(wb_rels_text, rel["id"])

    reused_rid = None
    if replace_index is not None:
        old_part = sheet_parts[replace_index]
        reused_rid = _sheet_rel_id(sheet_items[replace_index][2], wb_text)
        keep = {rel["part"] for rel in (picture_source[1] if picture_source else []) if rel["part"]}
        removed |= _orphaned_parts(old_part, all_rels, names, wb_rels_part, keep)

    # --- content types: bỏ override của part đã xóa TRƯỚC khi thêm part mới (part mới có thể dùng lại tên cũ)
    for part in removed:
        content_types = re.sub(r"<" + _PFX + r"Override\b[^>]*?PartName=\"/" + re.escape(part) + r"\"[^>]*?/>",
                               "", content_types, flags=re.I)

    # --- tên part mới
    taken = {n.lower() for n in names - removed}

    def next_name(directory, stem, ext):
        pattern = re.compile(re.escape(f"{directory}/{stem}") + r"(\d+)\." + ext + "$")
        numbers = [int(m.group(1)) for n in taken if (m := pattern.match(n))]
        candidate = f"{directory}/{stem}{max(numbers, default=0) + 1}.{ext}"
        taken.add(candidate.lower())
        return candidate

    sheet_dir = posixpath.dirname(sheet_parts[0]) if sheet_parts else posixpath.join(
        posixpath.dirname(workbook_part), "worksheets")
    new_sheet_part = next_name(sheet_dir, "sheet", "xml")

    # --- styles
    styles_rel = next(r for r in wb_rels if r["type"].endswith("/styles"))
    day_sheet, day_styles, shared = _read_day_sheet(day_path)
    new_styles, xf_map = _merge_styles(read(styles_rel["part"]), day_styles, _used_style_indexes(day_sheet))
    changed[styles_rel["part"]] = new_styles

    # --- drawing mới dùng lại ảnh có sẵn (không nhân bản file ảnh)
    drawing_rid = None
    if picture_source is not None:
        drawing_xml, picture_rels = picture_source
        drawing_dir = posixpath.join(posixpath.dirname(workbook_part), "drawings")
        new_drawing_part = next_name(drawing_dir, "drawing", "xml")
        added[new_drawing_part] = drawing_xml
        added[_rels_part_name(new_drawing_part)] = _rels_xml(picture_rels, new_drawing_part)
        drawing_rid = "rId1"
        added[_rels_part_name(new_sheet_part)] = _rels_xml(
            [{"id": drawing_rid, "type": _RT_DRAWING, "external": False, "part": new_drawing_part}], new_sheet_part)
        content_types = _add_override(content_types, new_drawing_part, _CT_DRAWING)

    tab_selected = replace_index is not None and replace_index == active_tab
    added[new_sheet_part] = _build_sheet_xml(day_sheet, xf_map, shared, drawing_rid, tab_selected)
    # thứ tự trong zip: sheet trước, quan hệ/drawing sau
    added = {new_sheet_part: added.pop(new_sheet_part), **added}
    content_types = _add_override(content_types, new_sheet_part, _CT_WORKSHEET)

    # --- quan hệ workbook
    existing_ids = {r["id"] for r in wb_rels}
    if reused_rid is not None:
        wb_rels_text = _remove_relationship(wb_rels_text, reused_rid)
        new_rid = reused_rid
    else:
        numbers = [int(m.group(1)) for rid in existing_ids if (m := re.fullmatch(r"rId(\d+)", rid or ""))]
        new_rid = f"rId{max(numbers, default=0) + 1}"
        while new_rid in existing_ids:
            new_rid = f"rId{int(new_rid[3:]) + 1}"
    rel_prefix = _element_prefix(wb_rels_text, "Relationships")
    target = posixpath.relpath(new_sheet_part, posixpath.dirname(workbook_part))
    new_rel = (f'<{rel_prefix}Relationship Id="{new_rid}" Type="{_RT_WORKSHEET}" '
               f'Target="{_escape_attr(target)}"/>')
    close = wb_rels_text.rindex(f"</{rel_prefix}Relationships>")
    wb_rels_text = wb_rels_text[:close] + new_rel + wb_rels_text[close:]
    changed[wb_rels_part] = wb_rels_text.encode("utf-8")

    # --- workbook.xml
    if replace_index is None:
        new_names = sheet_names[:position] + [final_name] + sheet_names[position:]
        wb_text = _insert_sheet_element(wb_text, sheet_items, sheets_prefix, sheets_close, position,
                                        final_name, new_rid)
        wb_text = _shift_sheet_indexes(wb_text, position)
    else:
        new_names = list(sheet_names)
    wb_text = _set_full_calc_on_load(wb_text)
    changed[workbook_part] = wb_text.encode("utf-8")

    changed["[Content_Types].xml"] = content_types.encode("utf-8")

    # --- docProps/app.xml (thông tin phụ; chỉ sửa khi cấu trúc đúng như mong đợi)
    if app_part and app_part in names and new_names != sheet_names:
        new_app = _update_app_titles(read(app_part), sheet_names, new_names)
        if new_app is not None:
            changed[app_part] = new_app

    for name in list(changed):
        if name in removed:
            del changed[name]
    return changed, added, removed, final_name


def _remove_relationship(rels_text: str, rel_id: str) -> str:
    pattern = re.compile(r"<" + _PFX + r"Relationship\b[^>]*?(?:/>|>\s*</" + _PFX + r"Relationship>)")

    def drop(match):
        start_tag = re.match(r"<[^>]*>", match.group(0)).group(0)
        return "" if _attrs(start_tag).get("Id") == rel_id else match.group(0)

    return pattern.sub(drop, rels_text)


def _add_override(content_types: str, part: str, content_type: str) -> str:
    prefix = _element_prefix(content_types, "Types")
    element = f'<{prefix}Override PartName="/{_escape_attr(part)}" ContentType="{content_type}"/>'
    close = content_types.rindex(f"</{prefix}Types>")
    return content_types[:close] + element + content_types[close:]


def _orphaned_parts(old_sheet: str, all_rels: dict, names: set, wb_rels_part: str, keep: set) -> set:
    """Sheet cũ + các part chỉ nó dùng (drawing, printerSettings...). Part còn được nơi khác tham chiếu
    (vd. ảnh dùng chung) thì giữ lại."""
    referenced_by = {}
    for rels_name, rels in all_rels.items():
        for rel in rels:
            if rel["part"]:
                referenced_by.setdefault(rel["part"], set()).add(rels_name)
    removed = set()
    stack = [old_sheet]
    while stack:
        part = stack.pop()
        if part in removed or part not in names or part in keep:
            continue
        holders = referenced_by.get(part, set()) - {_rels_part_name(p) for p in removed}
        if part == old_sheet:
            holders -= {wb_rels_part}
        if holders:
            continue
        removed.add(part)
        rels_name = _rels_part_name(part)
        if rels_name in all_rels:
            removed.add(rels_name)
            stack.extend(rel["part"] for rel in all_rels[rels_name] if rel["part"])
    # một part có thể được xét trước khi part giữ nó bị xóa: xét lại tới khi ổn định
    changed = True
    while changed:
        changed = False
        removed_rels = {_rels_part_name(p) for p in removed}
        for rels_name in list(removed_rels & set(all_rels)):
            for rel in all_rels[rels_name]:
                target = rel["part"]
                if not target or target in removed or target not in names or target in keep:
                    continue
                if not (referenced_by.get(target, set()) - removed_rels):
                    removed.add(target)
                    if _rels_part_name(target) in all_rels:
                        removed.add(_rels_part_name(target))
                    changed = True
    return removed


def _insert_sheet_element(wb_text, sheet_items, prefix, sheets_close, position, name, rid) -> str:
    sheet_ids = [int(attrs["sheetId"]) for _, _, attrs, _ in sheet_items if attrs.get("sheetId", "").isdigit()]
    new_id = max(sheet_ids, default=0) + 1
    rel_prefix = _root_prefix(wb_text, _REL_NS)
    if rel_prefix:
        element = f'<{prefix}sheet name="{_escape_attr(name)}" sheetId="{new_id}" {rel_prefix}id="{rid}"/>'
    else:
        element = (f'<{prefix}sheet xmlns:r="{_REL_NS}" name="{_escape_attr(name)}" sheetId="{new_id}" '
                   f'r:id="{rid}"/>')
    at = sheet_items[position][0] if position < len(sheet_items) else sheets_close
    return wb_text[:at] + element + wb_text[at:]


def _shift_sheet_indexes(wb_text: str, position: int) -> str:
    """Sau khi chèn sheet tại position: dời activeTab/firstSheet và localSheetId của definedName."""
    def fix_view(match):
        tag = match.group(0)
        attrs = _attrs(tag)
        active = int(attrs.get("activeTab", "0"))
        if position <= active:
            tag = _set_attr(tag, "activeTab", str(active + 1))
        first = int(attrs.get("firstSheet", "0"))
        if first and position <= first:
            tag = _set_attr(tag, "firstSheet", str(first + 1))
        return tag

    def fix_name(match):
        tag = match.group(0)
        local = _attrs(tag).get("localSheetId")
        if local is not None and local.isdigit() and int(local) >= position:
            tag = _set_attr(tag, "localSheetId", str(int(local) + 1))
        return tag

    wb_text = re.sub(r"<" + _PFX + r"workbookView\b[^>]*>", fix_view, wb_text)
    return re.sub(r"<" + _PFX + r"definedName\b[^>]*>", fix_name, wb_text)


def _set_full_calc_on_load(wb_text: str) -> str:
    calc = re.search(r"<" + _PFX + r"calcPr\b[^>]*>", wb_text)
    if calc:
        return wb_text[:calc.start()] + _set_attr(calc.group(0), "fullCalcOnLoad", "1") + wb_text[calc.end():]
    prefix = _element_prefix(wb_text, "workbook")
    anchor = re.search(r"<" + _PFX + r"(?:oleSize|customWorkbookViews|pivotCaches|smartTagPr|smartTagTypes|"
                       r"webPublishing|fileRecoveryPr|webPublishObjects|extLst)\b", wb_text)
    at = anchor.start() if anchor else wb_text.rindex(f"</{prefix}workbook>")
    return wb_text[:at] + f'<{prefix}calcPr fullCalcOnLoad="1"/>' + wb_text[at:]
