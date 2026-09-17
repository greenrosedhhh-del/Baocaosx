"""
VICO Production Report Management System - FastAPI Backend
Provides REST APIs for shift report entry, auto-aggregation across shifts, and Excel generation.
"""
import os
import json
from contextlib import asynccontextmanager
from datetime import datetime, date
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, HTTPException, Query, Request, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
from pydantic import BaseModel

import auth
import db
import excel_service

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

SECRET_KEY = os.environ.get("SECRET_KEY", "dev-insecure-secret-change-me")
IS_PRODUCTION = os.environ.get("ENV") == "production"
ALLOWED_ORIGINS = os.environ.get(
    "ALLOWED_ORIGINS", "http://localhost:8088,http://127.0.0.1:8088"
).split(",")


def bootstrap_admin() -> None:
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) as c FROM users")
    count = cursor.fetchone()["c"]
    if count == 0:
        username = os.environ.get("ADMIN_BOOTSTRAP_USERNAME", "admin")
        password = os.environ.get("ADMIN_BOOTSTRAP_PASSWORD", "admin123")
        cursor.execute(
            "INSERT INTO users (username, password_hash, full_name, role, active, created_at) "
            "VALUES (?, ?, ?, 'admin', 1, ?)",
            (username, auth.hash_password(password), "Quản trị viên",
             datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        )
        conn.commit()
    conn.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_schema()
    bootstrap_admin()
    yield


app = FastAPI(title="VICO Production Reporting System", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    SessionMiddleware,
    secret_key=SECRET_KEY,
    same_site="lax",
    https_only=IS_PRODUCTION,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------- MODELS ----------------
class PackagingItemModel(BaseModel):
    product_name: str
    customer: str
    from_val: Optional[str] = ""
    to_val: Optional[str] = ""
    weight_sorted: Optional[float] = 0
    weight_waste: Optional[float] = 0
    notes: Optional[str] = ""


class BasketItemModel(BaseModel):
    product_name: str
    customer: str
    from_val: Optional[str] = ""
    to_val: Optional[str] = ""
    steel_grade: Optional[str] = ""
    basket_count: Optional[float] = 0
    total_weight: Optional[float] = None
    notes: Optional[str] = ""


class TumblingItemModel(BaseModel):
    product_name: str
    customer: str
    m1: Optional[float] = 0
    m2: Optional[float] = 0
    total_weight: Optional[float] = 0
    notes: Optional[str] = ""


class ShiftReportModel(BaseModel):
    report_date: str
    shift_num: int
    safety_ppe: bool = True
    safety_equip: bool = True
    staff_total: int = 5
    staff_present: int = 5
    leave_permitted: int = 0
    leave_permitted_names: Optional[str] = ""
    leave_unpermitted: int = 0
    leave_unpermitted_names: Optional[str] = ""
    issues: Optional[str] = ""
    suggestions: Optional[str] = ""
    start_time: Optional[str] = ""
    end_time: Optional[str] = ""
    packaging: List[PackagingItemModel] = []
    baskets: List[BasketItemModel] = []
    tumbling: List[TumblingItemModel] = []


class LoginModel(BaseModel):
    username: str
    password: str


class UserCreateModel(BaseModel):
    username: str
    full_name: str
    password: str
    role: str = "leader"


class UserUpdateModel(BaseModel):
    full_name: Optional[str] = None
    password: Optional[str] = None
    active: Optional[bool] = None


# ---------------- AUTH ROUTES ----------------

@app.post("/api/auth/login")
def login(payload: LoginModel, request: Request):
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE username = ?", (payload.username,))
    row = cursor.fetchone()
    conn.close()
    if not row or not row["active"] or not auth.verify_password(payload.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Sai tên đăng nhập hoặc mật khẩu")
    request.session["user_id"] = row["id"]
    return {"username": row["username"], "full_name": row["full_name"], "role": row["role"]}


@app.post("/api/auth/logout")
def logout(request: Request):
    request.session.clear()
    return {"status": "ok"}


@app.get("/api/auth/me")
def me(user: dict = Depends(auth.require_user)):
    return {"username": user["username"], "full_name": user["full_name"], "role": user["role"]}


# ---------------- ADMIN: USER MANAGEMENT ----------------

@app.get("/api/admin/users")
def list_users(admin: dict = Depends(auth.require_admin)):
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, full_name, role, active, created_at FROM users ORDER BY id")
    users = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return users


@app.post("/api/admin/users")
def create_user(payload: UserCreateModel, admin: dict = Depends(auth.require_admin)):
    if payload.role not in ("admin", "leader"):
        raise HTTPException(status_code=400, detail="role phải là 'admin' hoặc 'leader'")

    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM users WHERE username = ?", (payload.username,))
    if cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail=f"Tên đăng nhập '{payload.username}' đã tồn tại")

    cursor.execute(
        "INSERT INTO users (username, password_hash, full_name, role, active, created_at) "
        "VALUES (?, ?, ?, ?, 1, ?)",
        (payload.username, auth.hash_password(payload.password), payload.full_name, payload.role,
         datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
    )
    conn.commit()
    user_id = cursor.lastrowid
    conn.close()
    return {"status": "success", "id": user_id}


@app.patch("/api/admin/users/{user_id}")
def update_user(user_id: int, payload: UserUpdateModel, admin: dict = Depends(auth.require_admin)):
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM users WHERE id = ?", (user_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")

    updates = []
    params = []
    if payload.full_name is not None:
        updates.append("full_name = ?")
        params.append(payload.full_name)
    if payload.password is not None:
        updates.append("password_hash = ?")
        params.append(auth.hash_password(payload.password))
    if payload.active is not None:
        updates.append("active = ?")
        params.append(int(payload.active))

    if updates:
        params.append(user_id)
        cursor.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)
        conn.commit()
    conn.close()
    return {"status": "success"}


# ---------------- SHIFT REPORT ROUTES ----------------

@app.get("/api/presets")
def get_presets(user: dict = Depends(auth.require_user)):
    return {
        "products": ["D25", "D40", "D60", "D80"],
        "customers": ["Molycop", "Nhập TQ", "Khô dầu", "VICO"],
        "steel_grades": ["CR18", "18", "CR20", "B2"],
        "shift_hours": {
            1: {"start": "6h", "end": "14h"},
            2: {"start": "14h", "end": "22h"},
            3: {"start": "22h", "end": "6h"}
        }
    }


@app.post("/api/shifts")
def save_shift_report(report: ShiftReportModel, user: dict = Depends(auth.require_user)):
    conn = db.get_db()
    cursor = conn.cursor()
    try:
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        shift_leader_name = user["full_name"]

        cursor.execute(
            "SELECT id, created_by_user_id FROM shifts WHERE report_date = ? AND shift_num = ?",
            (report.report_date, report.shift_num)
        )
        existing = cursor.fetchone()

        if existing:
            owner_id = existing["created_by_user_id"]
            if owner_id is not None and owner_id != user["id"] and user["role"] != "admin":
                raise HTTPException(
                    status_code=403,
                    detail=f"Báo cáo Ca {report.shift_num} ngày {report.report_date} đã được ca trưởng khác nộp, bạn không có quyền sửa."
                )
            shift_id = existing["id"]
            cursor.execute("""
            UPDATE shifts SET
                shift_leader = ?, safety_ppe = ?, safety_equip = ?,
                staff_total = ?, staff_present = ?, leave_permitted = ?,
                leave_permitted_names = ?, leave_unpermitted = ?, leave_unpermitted_names = ?,
                issues = ?, suggestions = ?, start_time = ?, end_time = ?, created_at = ?,
                updated_by_user_id = ?
            WHERE id = ?
            """, (
                shift_leader_name, int(report.safety_ppe), int(report.safety_equip),
                report.staff_total, report.staff_present, report.leave_permitted,
                report.leave_permitted_names, report.leave_unpermitted, report.leave_unpermitted_names,
                report.issues, report.suggestions, report.start_time, report.end_time, now_str,
                user["id"],
                shift_id
            ))
            cursor.execute("DELETE FROM packaging_items WHERE shift_id = ?", (shift_id,))
            cursor.execute("DELETE FROM basket_items WHERE shift_id = ?", (shift_id,))
            cursor.execute("DELETE FROM tumbling_items WHERE shift_id = ?", (shift_id,))
        else:
            cursor.execute("""
            INSERT INTO shifts (
                report_date, shift_num, shift_leader, safety_ppe, safety_equip,
                staff_total, staff_present, leave_permitted, leave_permitted_names,
                leave_unpermitted, leave_unpermitted_names, issues, suggestions,
                start_time, end_time, created_at, created_by_user_id, updated_by_user_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                report.report_date, report.shift_num, shift_leader_name,
                int(report.safety_ppe), int(report.safety_equip),
                report.staff_total, report.staff_present, report.leave_permitted,
                report.leave_permitted_names, report.leave_unpermitted,
                report.leave_unpermitted_names, report.issues, report.suggestions,
                report.start_time, report.end_time, now_str, user["id"], user["id"]
            ))
            shift_id = cursor.lastrowid

        for p in report.packaging:
            if p.product_name or p.customer or p.weight_sorted:
                cursor.execute("""
                INSERT INTO packaging_items (
                    shift_id, product_name, customer, from_val, to_val, weight_sorted, weight_waste, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (shift_id, p.product_name, p.customer, p.from_val, p.to_val, p.weight_sorted, p.weight_waste, p.notes))

        for b in report.baskets:
            if b.product_name or b.customer or b.basket_count:
                cursor.execute("""
                INSERT INTO basket_items (
                    shift_id, product_name, customer, from_val, to_val, steel_grade, basket_count, total_weight, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (shift_id, b.product_name, b.customer, b.from_val, b.to_val, b.steel_grade, b.basket_count, b.total_weight, b.notes))

        for t in report.tumbling:
            if t.product_name or t.customer or t.m1 or t.m2 or t.total_weight:
                cursor.execute("""
                INSERT INTO tumbling_items (
                    shift_id, product_name, customer, m1, m2, total_weight, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (shift_id, t.product_name, t.customer, t.m1, t.m2, t.total_weight, t.notes))

        conn.commit()
        return {"status": "success", "message": f"Báo cáo Ca {report.shift_num} ngày {report.report_date} đã được lưu thành công!", "shift_id": shift_id}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@app.get("/api/shifts")
def get_shifts(date: str = Query(..., description="YYYY-MM-DD"), user: dict = Depends(auth.require_user)):
    conn = db.get_db()
    cursor = conn.cursor()
    if user["role"] == "admin":
        cursor.execute("SELECT * FROM shifts WHERE report_date = ? ORDER BY shift_num", (date,))
    else:
        cursor.execute(
            "SELECT * FROM shifts WHERE report_date = ? AND created_by_user_id = ? ORDER BY shift_num",
            (date, user["id"])
        )
    shifts = [dict(row) for row in cursor.fetchall()]

    for s in shifts:
        s_id = s["id"]
        cursor.execute("SELECT * FROM packaging_items WHERE shift_id = ?", (s_id,))
        s["packaging"] = [dict(r) for r in cursor.fetchall()]
        cursor.execute("SELECT * FROM basket_items WHERE shift_id = ?", (s_id,))
        s["baskets"] = [dict(r) for r in cursor.fetchall()]
        cursor.execute("SELECT * FROM tumbling_items WHERE shift_id = ?", (s_id,))
        s["tumbling"] = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return shifts


def compute_daily_summary(report_date: str) -> dict:
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM shifts WHERE report_date = ? ORDER BY shift_num", (report_date,))
    shifts = [dict(row) for row in cursor.fetchall()]

    if not shifts:
        conn.close()
        return {
            "report_date": report_date,
            "submitted_shifts": [],
            "packaging": [],
            "baskets": [],
            "tumbling": [],
            "issues": [],
            "suggestions": "KO",
            "attendance": {"total_staff": 15, "present": 0, "leave_notes": "Ko", "leave_detail": "", "unpermitted": "Ko"}
        }

    shift_ids = [s["id"] for s in shifts]
    submitted_nums = [s["shift_num"] for s in shifts]

    total_staff = sum([s["staff_total"] for s in shifts]) or 15
    total_present = sum([s["staff_present"] for s in shifts])

    leave_names_list = []
    unpermitted_names_list = []
    for s in shifts:
        if s["leave_permitted_names"]:
            leave_names_list.append(f"Ca {s['shift_num']}: {s['leave_permitted_names']}")
        if s["leave_unpermitted_names"]:
            unpermitted_names_list.append(f"Ca {s['shift_num']}: {s['leave_unpermitted_names']}")

    leave_notes = "Ko" if not leave_names_list else "; ".join(leave_names_list)
    unpermitted = "Ko" if not unpermitted_names_list else "; ".join(unpermitted_names_list)

    cursor.execute(f"""
        SELECT product_name, customer,
               SUM(weight_sorted) as sum_sorted,
               SUM(weight_waste) as sum_waste,
               GROUP_CONCAT(notes, '; ') as combined_notes
        FROM packaging_items
        WHERE shift_id IN ({','.join(['?']*len(shift_ids))})
        GROUP BY product_name, customer
        ORDER BY sum_sorted DESC
    """, shift_ids)

    packaging_rows = []
    packaging_notes = []
    for r in cursor.fetchall():
        p_name = r["product_name"] or ""
        c_name = r["customer"] or ""
        notes = r["combined_notes"] or ""
        if "nghiệm thu" in notes.lower() or "lò" in notes.lower() or "xếp kho" in notes.lower():
            packaging_notes.append(f" - {notes}")
            item_notes = ""
        else:
            item_notes = notes

        packaging_rows.append({
            "product_name": p_name,
            "customer": c_name,
            "weight_sorted": r["sum_sorted"] or 0,
            "weight_waste": r["sum_waste"] or 0,
            "notes": item_notes
        })

    cursor.execute(f"""
        SELECT product_name, customer, steel_grade,
               SUM(basket_count) as sum_baskets,
               SUM(total_weight) as sum_weight,
               GROUP_CONCAT(notes, '; ') as combined_notes
        FROM basket_items
        WHERE shift_id IN ({','.join(['?']*len(shift_ids))})
        GROUP BY product_name, customer, steel_grade
        ORDER BY sum_baskets DESC
    """, shift_ids)

    basket_rows = []
    for r in cursor.fetchall():
        b_count = r["sum_baskets"] or 0
        w = r["sum_weight"] or (b_count * 350)
        basket_rows.append({
            "product_name": r["product_name"] or "",
            "customer": r["customer"] or "",
            "steel_grade": r["steel_grade"] or "",
            "basket_count": b_count,
            "total_weight": w,
            "notes": r["combined_notes"] or ""
        })

    cursor.execute(f"""
        SELECT product_name, customer, notes,
               SUM(m1) as sum_m1,
               SUM(m2) as sum_m2,
               SUM(total_weight) as sum_weight
        FROM tumbling_items
        WHERE shift_id IN ({','.join(['?']*len(shift_ids))})
        GROUP BY product_name, customer, notes
        ORDER BY sum_weight DESC
    """, shift_ids)

    tumbling_rows = []
    for r in cursor.fetchall():
        tumbling_rows.append({
            "product_name": r["product_name"] or "",
            "customer": r["customer"] or "",
            "m1": r["sum_m1"] or 0,
            "m2": r["sum_m2"] or 0,
            "total_weight": r["sum_weight"] or 0,
            "notes": r["notes"] or ""
        })

    issues_list = []
    for s in shifts:
        if s["issues"] and s["issues"].strip() and s["issues"].strip().upper() != "KO":
            lines = [l.strip() for l in s["issues"].split("\n") if l.strip()]
            for l in lines:
                clean_l = l.lstrip("-*• ")
                issues_list.append(f"Ca {s['shift_num']} ({s['shift_leader']}): {clean_l}")

    sugg_list = []
    for s in shifts:
        if s["suggestions"] and s["suggestions"].strip() and s["suggestions"].strip().upper() != "KO":
            sugg_list.append(f"Ca {s['shift_num']}: {s['suggestions']}")
    final_sugg = "; ".join(sugg_list) if sugg_list else "KO"

    conn.close()

    return {
        "report_date": report_date,
        "submitted_shifts": submitted_nums,
        "shift_count": len(submitted_nums),
        "attendance": {
            "total_staff": total_staff,
            "present": total_present,
            "leave_notes": leave_notes,
            "leave_detail": f"{total_staff - total_present} người nghỉ" if (total_staff - total_present) > 0 else "",
            "unpermitted": unpermitted
        },
        "packaging": packaging_rows,
        "packaging_notes": packaging_notes,
        "baskets": basket_rows,
        "basket_notes": "",
        "tumbling": tumbling_rows,
        "issues": issues_list,
        "suggestions": final_sugg,
        "reporter_name": "Ngọc Quang"
    }


@app.get("/api/daily-summary")
def get_daily_summary(date: str = Query(..., description="YYYY-MM-DD"), admin: dict = Depends(auth.require_admin)):
    return compute_daily_summary(date)


@app.get("/api/export-excel")
def export_excel_report(date: str = Query(..., description="YYYY-MM-DD"), admin: dict = Depends(auth.require_admin)):
    summary = compute_daily_summary(date)
    if not summary.get("submitted_shifts"):
        raise HTTPException(status_code=400, detail=f"Chưa có ca nào nộp báo cáo trong ngày {date} để xuất file!")

    file_path = excel_service.generate_excel_report(summary)
    dt_str = date.replace("-", "")
    return FileResponse(
        path=file_path,
        filename=f"BAO_CAO_TONG_HOP_{dt_str}.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


@app.post("/api/sync-to-master")
def sync_to_master(date: str = Query(..., description="YYYY-MM-DD"), admin: dict = Depends(auth.require_admin)):
    summary = compute_daily_summary(date)
    if not summary.get("submitted_shifts"):
        raise HTTPException(status_code=400, detail=f"Chưa có ca nào nộp báo cáo trong ngày {date}!")

    result = excel_service.sync_to_master(summary)
    return result


@app.get("/api/history")
def get_history(admin: dict = Depends(auth.require_admin)):
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT report_date,
               COUNT(id) as shift_count,
               GROUP_CONCAT(shift_num, ',') as shifts,
               GROUP_CONCAT(shift_leader, ', ') as leaders
        FROM shifts
        GROUP BY report_date
        ORDER BY report_date DESC
        LIMIT 30
    """)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


# Mount static files
os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8088, reload=True)
