document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const errorBox = document.getElementById('loginError');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';

    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (res.ok) {
        window.location.href = 'index.html';
      } else {
        const data = await res.json();
        errorBox.textContent = data.detail || 'Sai tên đăng nhập hoặc mật khẩu';
        errorBox.style.display = 'block';
      }
    } catch (err) {
      errorBox.textContent = 'Lỗi kết nối máy chủ: ' + err.message;
      errorBox.style.display = 'block';
    }
  });
});
