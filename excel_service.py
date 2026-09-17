"""
VICO Production Report - Excel Generation & Synchronization Service
Handles populating the standard VICO daily report template and syncing into master workbook.
"""
import os
import shutil
from datetime import datetime
import openpyxl

TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), "template_report.xlsx")
MASTER_PATH = os.path.join(os.path.dirname(__file__), "BÁO CÁO TỔNG HỢP HÀNG NGÀY.xlsx")
BACKUP_DIR = os.path.join(os.path.dirname(__file__), "backups")


def set_cell(ws, row: int, col: int, val):
    """Safely sets cell value even if coordinate falls inside a merged cell range."""
    cell = ws.cell(row=row, column=col)
    if type(cell).__name__ == 'MergedCell':
        for rng in ws.merged_cells.ranges:
            if cell.coordinate in rng:
                ws.cell(row=rng.min_row, column=rng.min_col, value=val)
                return
    cell.value = val


def format_sheet_name(date_str: str) -> str:
    """Converts '2026-09-14' or '14/09/2026' to '14.09.26 '"""
    if "-" in date_str:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
    else:
        dt = datetime.strptime(date_str, "%d/%m/%Y")
    return f"{dt.day:02d}.{dt.month:02d}.{str(dt.year)[2:]} "


def generate_excel_report(summary_data: dict, output_path: str = None) -> str:
    """
    Generates a single-sheet Excel workbook from summary_data.
    Returns the file path of generated xlsx.
    """
    if not os.path.exists(TEMPLATE_PATH):
        raise FileNotFoundError(f"Template file not found: {TEMPLATE_PATH}")

    wb = openpyxl.load_workbook(TEMPLATE_PATH)
    sheet_name = wb.sheetnames[0]
    ws = wb[sheet_name]

    date_str = summary_data.get("report_date", datetime.now().strftime("%Y-%m-%d"))
    if "-" in date_str:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
    else:
        dt = datetime.strptime(date_str, "%d/%m/%Y")
    
    formatted_sheet_name = format_sheet_name(date_str).strip()
    ws.title = formatted_sheet_name

    # 1. Header: Date (J4)
    set_cell(ws, 4, 10, f" Ngày lập :     {dt.day:02d} / {dt.month:02d} / {dt.year}")

    # 2. Chấm công
    attendance = summary_data.get("attendance", {})
    total_staff = attendance.get("total_staff", 5)
    present = attendance.get("present", 5)
    leave_notes = attendance.get("leave_notes", "Ko")
    leave_detail = attendance.get("leave_detail", "")
    unpermitted = attendance.get("unpermitted", "Ko")

    set_cell(ws, 10, 11, f"Tổng sĩ số: ___{total_staff}___")
    set_cell(ws, 11, 11, f"Có mặt: __{present}__")
    set_cell(ws, 13, 11, "1. Nghỉ phép:")
    set_cell(ws, 13, 12, leave_notes if leave_notes else "Ko")
    if leave_detail:
        set_cell(ws, 17, 11, leave_detail)
    set_cell(ws, 18, 11, f"2. Nghỉ không phép:       {unpermitted if unpermitted else 'Ko'}")

    # 3. Mục 1: BAO GÓI SẢN PHẨM (Row 11 to 14)
    packaging_items = summary_data.get("packaging", [])
    for idx, item in enumerate(packaging_items[:4]):
        r = 11 + idx
        set_cell(ws, r, 1, item.get("product_name", ""))
        set_cell(ws, r, 2, item.get("customer", ""))
        set_cell(ws, r, 3, item.get("from_val", ""))
        set_cell(ws, r, 4, item.get("to_val", ""))
        weight_sorted = item.get("weight_sorted")
        weight_waste = item.get("weight_waste")
        
        set_cell(ws, r, 5, weight_sorted if weight_sorted is not None else "")
        set_cell(ws, r, 7, weight_waste if weight_waste is not None else "")
        if weight_sorted and weight_waste:
            set_cell(ws, r, 9, f"=G{r}/E{r}*100")
        elif weight_waste == 0:
            set_cell(ws, r, 9, 0)
        set_cell(ws, r, 10, item.get("notes", ""))

    # Ghi chú thêm bao gói (Row 15 & 16)
    extra_packaging_notes = summary_data.get("packaging_notes", [])
    if len(extra_packaging_notes) > 0:
        set_cell(ws, 15, 1, extra_packaging_notes[0])
    if len(extra_packaging_notes) > 1:
        set_cell(ws, 16, 1, extra_packaging_notes[1])

    # 4. Mục 2: SỐ LƯỢNG GIỎ BI RA SAU TÔI (Data starts at Row 21 to 24)
    basket_items = summary_data.get("baskets", [])
    for idx, item in enumerate(basket_items[:4]):
        r = 21 + idx
        set_cell(ws, r, 1, item.get("product_name", ""))
        set_cell(ws, r, 2, item.get("customer", ""))
        set_cell(ws, r, 3, item.get("from_val", ""))
        set_cell(ws, r, 4, item.get("to_val", ""))
        set_cell(ws, r, 5, item.get("steel_grade", ""))
        basket_count = item.get("basket_count")
        set_cell(ws, r, 7, basket_count if basket_count is not None else "")
        total_weight = item.get("total_weight")
        if total_weight is not None:
            set_cell(ws, r, 9, total_weight)
        elif basket_count:
            set_cell(ws, r, 9, f"=G{r}*350")
        set_cell(ws, r, 10, item.get("notes", ""))

    # Ghi chú sau tôi (Row 25)
    extra_basket_notes = summary_data.get("basket_notes", "")
    if extra_basket_notes:
        set_cell(ws, 25, 1, extra_basket_notes)

    # 5. Mục 3: SỐ MẺ BI XÓC (Data starts at Row 30 to 35)
    tumbling_items = summary_data.get("tumbling", [])
    for idx, item in enumerate(tumbling_items[:6]):
        r = 30 + idx
        set_cell(ws, r, 1, item.get("product_name", ""))
        set_cell(ws, r, 2, item.get("customer", ""))
        m1 = item.get("m1")
        m2 = item.get("m2")
        set_cell(ws, r, 3, m1 if m1 is not None else "")
        set_cell(ws, r, 5, m2 if m2 is not None else "")
        set_cell(ws, r, 7, item.get("total_weight", ""))
        set_cell(ws, r, 9, item.get("notes", ""))

    # 6. SỰ CỐ TRONG CA (Cột J hàng 28-35)
    issues_list = summary_data.get("issues", [])
    if issues_list:
        issues_text = "\n".join([f" - {iss}" if not iss.strip().startswith("-") else iss for iss in issues_list])
        set_cell(ws, 28, 10, issues_text)

    # 7. Yêu cầu - Đề xuất
    suggestions = summary_data.get("suggestions", "KO")
    set_cell(ws, 38, 1, suggestions if suggestions else "KO")

    # 8. Thời gian làm việc các ca
    set_cell(ws, 38, 9, "Thời gian làm việc của Ca 1 từ :   6h - 14h ")
    set_cell(ws, 39, 9, "Thời gian làm việc của Ca 2 từ :  14h - 22h ")
    set_cell(ws, 40, 9, "Thời gian làm việc của Ca 3 từ :  22h - 6h ")

    # 9. Người báo cáo
    reporter_name = summary_data.get("reporter_name", "Ngọc Quang")
    set_cell(ws, 45, 8, f"                              {reporter_name}")

    if not output_path:
        exports_dir = os.path.join(os.path.dirname(__file__), "exports")
        os.makedirs(exports_dir, exist_ok=True)
        filename = f"BAO_CAO_{dt.strftime('%Y%m%d')}.xlsx"
        output_path = os.path.join(exports_dir, filename)

    wb.save(output_path)
    return output_path


def backup_master_workbook() -> str:
    """Creates a timestamped copy of MASTER_PATH in backups/"""
    if not os.path.exists(MASTER_PATH):
        return ""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = os.path.join(BACKUP_DIR, f"BAO_CAO_TONG_HOP_backup_{timestamp}.xlsx")
    shutil.copy2(MASTER_PATH, backup_path)
    return backup_path


def sync_to_master(summary_data: dict) -> dict:
    """
    Safely syncs the daily summary into the master file BÁO CÁO TỔNG HỢP HÀNG NGÀY.xlsx
    Returns status and backup information.
    """
    if not os.path.exists(MASTER_PATH):
        raise FileNotFoundError(f"Master workbook not found: {MASTER_PATH}")

    # 1. Generate the single-day report
    temp_path = os.path.join(os.path.dirname(__file__), "temp_day_report.xlsx")
    generate_excel_report(summary_data, temp_path)

    # 2. Backup master
    backup_file = backup_master_workbook()

    # 3. Load temp sheet
    wb_temp = openpyxl.load_workbook(temp_path)
    src_sheet = wb_temp.active
    target_sheet_name = src_sheet.title.strip()

    # 4. Load master
    wb_master = openpyxl.load_workbook(MASTER_PATH)
    
    # Check if sheet exists
    existing_sheet_names = [s.strip() for s in wb_master.sheetnames]
    if target_sheet_name in existing_sheet_names:
        for s in wb_master.sheetnames:
            if s.strip() == target_sheet_name:
                wb_master.remove(wb_master[s])
                break

    # Create new sheet at the end of master
    new_ws = wb_master.create_sheet(title=f"{target_sheet_name} ")

    # Copy cells
    for row in src_sheet.iter_rows():
        for cell in row:
            new_cell = new_ws.cell(row=cell.row, column=cell.column, value=cell.value)
            if cell.has_style:
                new_cell.font = cell.font.copy()
                new_cell.border = cell.border.copy()
                new_cell.fill = cell.fill.copy()
                new_cell.number_format = cell.number_format
                new_cell.protection = cell.protection.copy()
                new_cell.alignment = cell.alignment.copy()

    for col_letter, col_dim in src_sheet.column_dimensions.items():
        new_ws.column_dimensions[col_letter].width = col_dim.width
    for r_idx, r_dim in src_sheet.row_dimensions.items():
        new_ws.row_dimensions[r_idx].height = r_dim.height
    for m_range in src_sheet.merged_cells.ranges:
        new_ws.merge_cells(str(m_range))

    wb_master.save(MASTER_PATH)
    if os.path.exists(temp_path):
        os.remove(temp_path)

    return {
        "status": "success",
        "sheet_name": f"{target_sheet_name} ",
        "backup_file": backup_file,
        "master_path": MASTER_PATH
    }
