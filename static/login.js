document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const errorBox = document.getElementById('loginError');
  const errorText = document.getElementById('loginErrorText');
  const usernameInput = document.getElementById('loginUsername');
  const passwordInput = document.getElementById('loginPassword');
  const btnSubmit = document.getElementById('btnSubmitLogin');
  const btnSubmitText = btnSubmit.querySelector('.btn-login-text');
  const btnTogglePassword = document.getElementById('btnTogglePassword');
  const pwToggleIcon = document.getElementById('pwToggleIcon');


  // Password visibility toggle
  if (btnTogglePassword && passwordInput) {
    btnTogglePassword.addEventListener('click', () => {
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';
      pwToggleIcon.textContent = isPassword ? '🙈' : '👁️';
    });
  }

  // Submit Handler
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
      showError('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu');
      return;
    }

    try {
      btnSubmit.disabled = true;
      btnSubmitText.textContent = 'ĐANG ĐĂNG NHẬP...';

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (res.ok) {
        btnSubmitText.textContent = '✓ THÀNH CÔNG!';
        setTimeout(() => {
          window.location.href = 'index.html';
        }, 300);
      } else {
        const data = await res.json();
        showError(data.detail || 'Sai tên đăng nhập hoặc mật khẩu!');
      }
    } catch (err) {
      showError('Lỗi kết nối máy chủ: ' + err.message);
    } finally {
      if (btnSubmitText.textContent !== '✓ THÀNH CÔNG!') {
        btnSubmit.disabled = false;
        btnSubmitText.textContent = 'ĐĂNG NHẬP HỆ THỐNG';
      }
    }
  });

  function showError(msg) {
    errorText.textContent = msg;
    errorBox.style.display = 'flex';
    errorBox.classList.remove('shake');
    void errorBox.offsetWidth; // Trigger reflow for re-animation
    errorBox.classList.add('shake');
    passwordInput.focus();
  }
});
