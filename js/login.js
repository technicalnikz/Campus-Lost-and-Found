function togglePasswordVisibility(inputId, btn) {
      const input = document.getElementById(inputId);
      if (!input) return;
      const showPassword = input.type === 'password';
      input.type = showPassword ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(showPassword));
      btn.setAttribute('aria-label', showPassword ? 'Hide password' : 'Show password');
      btn.setAttribute('title', showPassword ? 'Hide password' : 'Show password');
      btn.innerHTML = showPassword
        ? '<svg class="password-toggle-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a15.8 15.8 0 0 1-3.1 3.8M6.2 6.2C3.5 8.1 2 12 2 12s3.6 7 10 7a10.8 10.8 0 0 0 4.1-.8" /></svg>'
        : '<svg class="password-toggle-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>';
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

    async function redirectAuthenticatedUser() {
      document.body.classList.add('auth-checking');
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
        if (response.ok) {
          const data = await response.json();
          if (data.authenticated && data.user && ['admin', 'student'].includes(data.user.role)) {
            window.location.replace(getPostLoginUrl(data.user));
            return;
          }
        }
      } catch (error) {
        // Leave the sign-in form available while session verification is unavailable.
      }
      document.body.classList.remove('auth-checking');
    }

    // Theme initialization and click handling are provided by the shared main.js.

    function showAuthForm(formId) {
      ['loginForm', 'registerForm', 'forgotForm', 'resetForm'].forEach(id => {
        document.getElementById(id).style.display = id === formId ? 'block' : 'none';
      });
      document.getElementById('tabLogin').classList.toggle('active', formId !== 'registerForm');
      document.getElementById('tabRegister').classList.toggle('active', formId === 'registerForm');
      hideError();
    }

    function switchTab(tab) {
      showAuthForm(tab === 'login' ? 'loginForm' : 'registerForm');
    }

    function showForgotPassword() {
      showAuthForm('forgotForm');
      document.getElementById('forgotEmail').value = document.getElementById('loginEmail').value.trim();
      document.getElementById('forgotEmail').focus();
    }

    async function handleForgotPassword(e) {
      e.preventDefault();
      hideError();
      const button = document.getElementById('forgotSubmit');
      button.disabled = true;
      try {
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ email: document.getElementById('forgotEmail').value.trim() })
        });
        const data = await res.json();
        if (data.success) showNotice(data.message);
        else showError(data.message || 'Could not send the reset link.');
      } catch (err) {
        showError('Network error connecting to authentication service.');
      } finally {
        button.disabled = false;
      }
    }

    // The reset token is read once from the emailed link and kept out of the address bar.
    let passwordResetToken = null;

    function openResetFromLink() {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('reset');
      if (!token) return false;
      passwordResetToken = token;
      params.delete('reset');
      const query = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
      showAuthForm('resetForm');
      return true;
    }

    async function handleResetPassword(e) {
      e.preventDefault();
      hideError();
      const password = document.getElementById('resetPassword').value;
      if (password !== document.getElementById('resetPasswordConfirm').value) {
        showError('The two passwords do not match.');
        return;
      }
      const button = document.getElementById('resetSubmit');
      button.disabled = true;
      try {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ token: passwordResetToken, password })
        });
        const data = await res.json();
        if (data.success) {
          passwordResetToken = null;
          document.getElementById('resetForm').reset();
          showAuthForm('loginForm');
          showNotice(data.message);
        } else if (data.code === 'RESET_LINK_INVALID') {
          showAuthForm('forgotForm');
          showError(data.message);
        } else {
          showError(data.message || 'Could not reset the password.');
        }
      } catch (err) {
        showError('Network error connecting to authentication service.');
      } finally {
        button.disabled = false;
      }
    }

    function showError(msg) {
      const box = document.getElementById('authError');
      box.innerText = msg;
      box.style.display = 'block';
    }

    function hideError() {
      document.getElementById('authError').style.display = 'none';
      document.getElementById('authNotice').style.display = 'none';
    }

    function showNotice(msg) {
      const box = document.getElementById('authNotice');
      box.innerText = msg;
      box.style.display = 'block';
    }

    // Result of opening the confirmation link from the verification email.
    function showVerificationResult() {
      const params = new URLSearchParams(window.location.search);
      const result = params.get('verified');
      if (!result) return;
      if (result === 'success') showNotice('Your email is confirmed. You can now sign in.');
      else if (result === 'expired') showError('That confirmation link has expired. Sign in with your email and password to receive a new one.');
      else showError('That confirmation link is invalid or was already used. Sign in to receive a new one if needed.');
      params.delete('verified');
      const query = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
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
          sessionStorage.setItem('currentUser', JSON.stringify(data.user));
          sessionStorage.setItem('userRole', data.user.role);
          window.location.replace(getPostLoginUrl(data.user));
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
          // New accounts stay locked until the emailed confirmation link is opened.
          document.getElementById('registerForm').reset();
          updatePasswordRequirements();
          switchTab('login');
          document.getElementById('loginEmail').value = email;
          if (data.emailSent === false) showError(data.message);
          else showNotice(data.message);
        } else {
          showError(data.message || (data.errors ? data.errors.join(' ') : 'Registration failed.'));
        }
      } catch (err) {
        showError('Network error connecting to registration service.');
      }
    }

    document.getElementById('regPassword').addEventListener('input', updatePasswordRequirements);
    updatePasswordRequirements();
    showVerificationResult();
    if (openResetFromLink()) document.body.classList.remove('auth-checking');
    else redirectAuthenticatedUser();
    window.addEventListener('pageshow', event => {
      if (event.persisted && !passwordResetToken) redirectAuthenticatedUser();
    });
