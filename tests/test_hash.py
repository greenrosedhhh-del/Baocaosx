import auth


def test_hash_password_produces_different_hash_each_time():
    h1 = auth.hash_password("secret123")
    h2 = auth.hash_password("secret123")
    assert h1 != h2


def test_verify_password_accepts_correct_password():
    h = auth.hash_password("secret123")
    assert auth.verify_password("secret123", h) is True


def test_verify_password_rejects_wrong_password():
    h = auth.hash_password("secret123")
    assert auth.verify_password("wrong", h) is False
