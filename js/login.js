function togglePasswordVisibility(inputId, btn) {
      const input = document.getElementById(inputId);
      if (!input) return;
      if (input.type === 'password') {
        input.type = 'text';
        btn.innerText = 'Hide';
        btn.style.borderColor = 'rgba(239, 68, 68, 0.5)';
        btn.style.color = '#fca5a5';
        btn.style.background = 'rgba(239, 68, 68, 0.15)';
      } else {
        input.type = 'password';
        btn.innerText = 'Show';
        btn.style.borderColor = 'rgba(59, 130, 246, 0.35)';
        btn.style.color = 'var(--blue-light)';
        btn.style.background = 'rgba(37, 99, 235, 0.15)';
      }
    }

    // Theme toggle
    function toggleTheme() {
      const html = document.documentElement;
      const current = html.getAttribute('data-theme') || 'dark';
      const next = current === 'light' ? 'dark' : 'light';
      html.setAttribute('data-theme', next);
      localStorage.setItem('cspc_theme', next);
      updateThemeIcon();
    }

    function updateThemeIcon() {
      const theme = document.documentElement.getAttribute('data-theme') || 'dark';
      document.querySelectorAll('.theme-toggle').forEach(btn => {
        btn.innerHTML = `<span class="theme-toggle-icon">${theme === 'light' ? '☀️' : '🌙'}</span>`;
        btn.setAttribute('title', theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode');
        btn.setAttribute('aria-label', theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode');
      });
    }

    function loadTheme() {
      const saved = localStorage.getItem('cspc_theme') || 'dark';
      document.documentElement.setAttribute('data-theme', saved);
      updateThemeIcon();
    }

    function getPostLoginUrl(user) {
      const requestedPath = new URLSearchParams(window.location.search).get('redirect');
      if (requestedPath) {
        const destination = new URL(requestedPath, window.location.origin);
        if (
          destination.origin === window.location.origin &&
          destination.pathname.startsWith('/') &&
          !(user.role !== 'admin' && destination.pathname === '/admin.html')
        ) {
          return `${destination.pathname}${destination.search}${destination.hash}`;
        }
      }
      return user.role === 'admin' ? '/admin.html' : '/';
    }

    document.addEventListener('DOMContentLoaded', () => {
      loadTheme();
      document.querySelectorAll('.theme-toggle').forEach(button => {
        if (button.dataset.loginThemeBound === 'true') return;
        button.dataset.loginThemeBound = 'true';
        button.addEventListener('click', event => {
          event.stopPropagation();
          toggleTheme();
        });
      });
    });

    function switchTab(tab) {
      const isLogin = tab === 'login';
      document.getElementById('tabLogin').classList.toggle('active', isLogin);
      document.getElementById('tabRegister').classList.toggle('active', !isLogin);
      document.getElementById('loginForm').style.display = isLogin ? 'block' : 'none';
      document.getElementById('registerForm').style.display = isLogin ? 'none' : 'block';
      hideError();
    }

    function showError(msg) {
      const box = document.getElementById('authError');
      box.innerText = msg;
      box.style.display = 'block';
    }

    function hideError() {
      document.getElementById('authError').style.display = 'none';
    }

    function updatePasswordRequirements() {
      const password = document.getElementById('regPassword').value;
      const requirements = {
        length: password.length >= 8,
        uppercase: /[A-Z]/.test(password),
        lowercase: /[a-z]/.test(password),
        number: /[0-9]/.test(password),
        special: /[!@#$%?&*]/.test(password)
      };

      Object.entries(requirements).forEach(([name, satisfied]) => {
        const item = document.querySelector(`[data-requirement="${name}"]`);
        item.classList.toggle('satisfied', satisfied);
        item.setAttribute('aria-label', `${satisfied ? 'Met' : 'Required'}: ${item.textContent}`);
      });

      document.getElementById('registerSubmit').disabled = !Object.values(requirements).every(Boolean);
    }

    async function handleLogin(e) {
      e.preventDefault();
      hideError();

      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ email, password })
        });

        const data = await res.json();
        if (data.success) {
          if (data.emailSent === false) window.alert(data.message);
          sessionStorage.setItem('currentUser', JSON.stringify(data.user));
          sessionStorage.setItem('userRole', data.user.role);
          window.location.href = getPostLoginUrl(data.user);
        } else {
          showError(data.message || 'Login failed. Please check your credentials.');
        }
      } catch (err) {
        showError('Network error connecting to authentication service.');
      }
    }

    async function handleRegister(e) {
      e.preventDefault();
      hideError();
      updatePasswordRequirements();

      if (document.getElementById('registerSubmit').disabled) {
        showError('Please meet all password requirements before registering.');
        return;
      }

      const fullName = document.getElementById('regFullName').value.trim();
      const studentId = document.getElementById('regStudentId').value.trim();
      const department = document.getElementById('regDepartment').value;
      const email = document.getElementById('regEmail').value.trim();
      const password = document.getElementById('regPassword').value;

      if (!department) {
        showError('Please select your college department.');
        return;
      }

      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ fullName, studentId, department, email, password })
        });

        const data = await res.json();
        if (data.success) {
          sessionStorage.setItem('currentUser', JSON.stringify(data.user));
          sessionStorage.setItem('userRole', data.user.role);
          window.location.href = '/';
        } else {
          showError(data.message || (data.errors ? data.errors.join(' ') : 'Registration failed.'));
        }
      } catch (err) {
        showError('Network error connecting to registration service.');
      }
    }

    document.getElementById('regPassword').addEventListener('input', updatePasswordRequirements);
    updatePasswordRequirements();
