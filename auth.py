"""Password hashing and session-based authentication for the VICO reporting system."""
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, Request

import db


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def get_current_user(request: Request) -> Optional[dict]:
    user_id = request.session.get("user_id")
    if not user_id:
        return None
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, username, full_name, role, active FROM users WHERE id = ?",
        (user_id,),
    )
    row = cursor.fetchone()
    conn.close()
    if not row or not row["active"]:
        return None
    return dict(row)


def require_user(request: Request) -> dict:
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Chưa đăng nhập")
    return user


def require_admin(user: dict = Depends(require_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Chỉ admin mới có quyền truy cập")
    return user
