def test_login_fails_with_wrong_password(client):
    resp = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    assert resp.status_code == 401


def test_login_succeeds_with_bootstrap_admin(client):
    resp = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["role"] == "admin"
    assert data["username"] == "admin"


def test_me_requires_login(client):
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401


def test_me_returns_current_user_after_login(client):
    client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    resp = client.get("/api/auth/me")
    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"


def test_logout_clears_session(client):
    client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    client.post("/api/auth/logout")
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401
