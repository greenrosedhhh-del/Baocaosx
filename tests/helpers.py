"""Tiện ích dùng chung cho test: tạo tài khoản và hoàn tất đổi mật khẩu tạm như người dùng thật."""
ADMIN_PASSWORD = "admin123"
TEMP_PASSWORD = "tam12345"


def login(client, username, password):
    resp = client.post("/api/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()


def login_admin(client):
    return login(client, "admin", ADMIN_PASSWORD)


def create_active_user(client, username, full_name, password="leader123", role="leader"):
    """Admin tạo tài khoản với mật khẩu tạm, người dùng đăng nhập và đổi sang `password`."""
    login_admin(client)
    resp = client.post("/api/admin/users", json={
        "username": username, "full_name": full_name, "password": TEMP_PASSWORD, "role": role
    })
    assert resp.status_code == 200, resp.text
    user_id = resp.json()["id"]
    client.post("/api/auth/logout")

    login(client, username, TEMP_PASSWORD)
    resp = client.post("/api/auth/change-password", json={
        "current_password": TEMP_PASSWORD, "new_password": password
    })
    assert resp.status_code == 200, resp.text
    client.post("/api/auth/logout")
    return user_id
