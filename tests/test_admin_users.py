def _login_admin(client):
    resp = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert resp.status_code == 200


def test_unauthenticated_cannot_list_users(client):
    resp = client.get("/api/admin/users")
    assert resp.status_code == 401


def test_create_and_list_user(client):
    _login_admin(client)
    resp = client.post("/api/admin/users", json={
        "username": "tan", "full_name": "Tân", "password": "leader123", "role": "leader"
    })
    assert resp.status_code == 200
    assert "id" in resp.json()

    resp = client.get("/api/admin/users")
    usernames = [u["username"] for u in resp.json()]
    assert "tan" in usernames


def test_create_user_rejects_duplicate_username(client):
    _login_admin(client)
    client.post("/api/admin/users", json={
        "username": "tan", "full_name": "Tân", "password": "leader123", "role": "leader"
    })
    resp = client.post("/api/admin/users", json={
        "username": "tan", "full_name": "Tân 2", "password": "abc12345", "role": "leader"
    })
    assert resp.status_code == 400


def test_admin_can_deactivate_user_and_blocks_their_login(client):
    _login_admin(client)
    create_resp = client.post("/api/admin/users", json={
        "username": "hai", "full_name": "Hải", "password": "leader123", "role": "leader"
    })
    user_id = create_resp.json()["id"]

    resp = client.patch(f"/api/admin/users/{user_id}", json={"active": False})
    assert resp.status_code == 200

    client.post("/api/auth/logout")
    resp = client.post("/api/auth/login", json={"username": "hai", "password": "leader123"})
    assert resp.status_code == 401


def test_leader_account_cannot_manage_users(client):
    _login_admin(client)
    client.post("/api/admin/users", json={
        "username": "quang", "full_name": "Quang", "password": "leader123", "role": "leader"
    })
    client.post("/api/auth/logout")
    client.post("/api/auth/login", json={"username": "quang", "password": "leader123"})

    resp = client.get("/api/admin/users")
    assert resp.status_code == 403


def test_create_user_rejects_invalid_role(client):
    _login_admin(client)
    resp = client.post("/api/admin/users", json={
        "username": "baduser", "full_name": "Bad", "password": "leader123", "role": "superadmin"
    })
    assert resp.status_code == 400


def test_leader_cannot_create_or_update_users(client):
    _login_admin(client)
    client.post("/api/admin/users", json={
        "username": "quang2", "full_name": "Quang2", "password": "leader123", "role": "leader"
    })
    client.post("/api/auth/logout")
    client.post("/api/auth/login", json={"username": "quang2", "password": "leader123"})

    resp = client.post("/api/admin/users", json={
        "username": "x", "full_name": "X", "password": "abc12345", "role": "leader"
    })
    assert resp.status_code == 403

    resp = client.patch("/api/admin/users/1", json={"active": False})
    assert resp.status_code == 403
