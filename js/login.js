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
        btn.innerHTML = themeToggleIconHtml(theme);
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
      ['loginForm', 'registerForm', 'forgotForm', 'resetForm', 'otpForm'].forEach(id => {
        document.getElementById(id).style.display = id === formId ? 'block' : 'none';
      });
      // The code step has its own header and back button instead of the tabs.
      document.querySelector('.auth-tabs').style.display = formId === 'otpForm' ? 'none' : '';
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
      else if (result === 'expired') showError('That confirmation link has expired. Sign in with your email and password to get a verification code instead.');
      else showError('That confirmation link is invalid or was already used. Sign in to get a verification code if needed.');
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

    // Sign-in and sign-up wait for the code email to be sent, which takes a few
    // seconds. The button shows that it is working and ignores repeat clicks, so a
    // second request cannot send a second code that replaces the first.
    let authRequestBusy = false;

    async function runWhileBusy(buttonId, busyLabel, request) {
      if (authRequestBusy) return;
      authRequestBusy = true;
      const button = document.getElementById(buttonId);
      const label = button.textContent;
      button.disabled = true;
      button.classList.add('is-busy');
      button.textContent = busyLabel;
      try {
        await request();
      } finally {
        authRequestBusy = false;
        button.classList.remove('is-busy');
        button.textContent = label;
        button.disabled = false;
      }
    }

    function handleLogin(e) {
      e.preventDefault();
      return runWhileBusy('loginSubmit', 'Signing in…', submitLogin);
    }

    async function submitLogin() {
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
        // A correct password always leads to the emailed code (a sign-up code if the
        // email is not confirmed yet).
        if (data.otpRequired) {
          showOtpStep(data, 'loginForm');
          document.getElementById('loginPassword').value = '';
        } else if (data.success && data.user) {
          finishSignIn(data.user);
        } else {
          showError(data.message || 'Login failed. Please check your credentials.');
        }
      } catch (err) {
        showError('Network error connecting to authentication service.');
      }
    }

    function finishSignIn(user) {
      sessionStorage.setItem('currentUser', JSON.stringify(user));
      sessionStorage.setItem('userRole', user.role);
      window.location.replace(getPostLoginUrl(user));
    }

    // ── Email code step ─────────────────────────────────────────────────────
    let otpReturnForm = 'loginForm';
    let otpCountdownTimer = null;
    let otpVerifying = false;

    function otpBoxes() {
      return [...document.querySelectorAll('#otpBoxes .otp-box')];
    }

    function restartAnimation(element, className) {
      element.classList.remove(className);
      void element.offsetWidth; // reflow so the animation plays again
      element.classList.add(className);
    }

    function showOtpStep(data, returnForm) {
      otpReturnForm = returnForm;
      const form = document.getElementById('otpForm');
      const isSignup = data.purpose === 'signup';
      document.getElementById('otpTitle').textContent = isSignup ? 'Email Verification' : 'OTP Verification';
      document.getElementById('otpEmail').textContent = data.email || 'your CSPC email';
      document.querySelector('#otpForm .otp-back').setAttribute('aria-label', returnForm === 'registerForm' ? 'Back to registration' : 'Back to sign in');
      form.classList.remove('is-success');
      clearOtpBoxes();
      showAuthForm('otpForm');
      restartAnimation(form, 'is-entering');
      if (data.emailSent === false) showError(data.message);
      else if (isSignup && returnForm === 'loginForm') showNotice(data.message);
      startResendCountdown(data.resendAfter || 60);
      otpBoxes()[0].focus();
    }

    function leaveOtpStep() {
      clearInterval(otpCountdownTimer);
      showAuthForm(otpReturnForm);
    }

    function clearOtpBoxes() {
      otpBoxes().forEach(box => {
        box.value = '';
        box.classList.remove('is-filled', 'is-pop');
      });
      document.getElementById('otpBoxes').classList.remove('is-error');
    }

    function setOtpBox(box, digit) {
      box.value = digit;
      box.classList.toggle('is-filled', Boolean(digit));
      if (digit) restartAnimation(box, 'is-pop');
    }

    // Puts digits into the boxes from `index` on (typing, paste or phone autofill),
    // then submits once all six are in.
    function fillOtpFrom(index, digits) {
      const boxes = otpBoxes();
      for (const digit of digits) {
        if (index >= boxes.length) break;
        setOtpBox(boxes[index], digit);
        index += 1;
      }
      boxes[Math.min(index, boxes.length - 1)].focus();
      if (boxes.every(box => box.value)) {
        setTimeout(() => document.getElementById('otpForm').requestSubmit(), 180);
      }
    }

    function setupOtpBoxes() {
      const boxes = otpBoxes();
      boxes.forEach((box, index) => {
        box.addEventListener('input', () => {
          const digits = box.value.replace(/\D/g, '');
          document.getElementById('otpBoxes').classList.remove('is-error');
          if (!digits) {
            setOtpBox(box, '');
            return;
          }
          fillOtpFrom(index, digits);
        });
        box.addEventListener('keydown', event => {
          if (event.key === 'Backspace' && !box.value && index > 0) {
            event.preventDefault();
            setOtpBox(boxes[index - 1], '');
            boxes[index - 1].focus();
          } else if (event.key === 'ArrowLeft' && index > 0) {
            event.preventDefault();
            boxes[index - 1].focus();
          } else if (event.key === 'ArrowRight' && index < boxes.length - 1) {
            event.preventDefault();
            boxes[index + 1].focus();
          }
        });
        box.addEventListener('paste', event => {
          const digits = (event.clipboardData?.getData('text') || '').replace(/\D/g, '');
          if (!digits) return;
          event.preventDefault();
          fillOtpFrom(digits.length >= boxes.length ? 0 : index, digits);
        });
        box.addEventListener('focus', () => box.select());
      });
    }

    function showOtpError(message) {
      const row = document.getElementById('otpBoxes');
      restartAnimation(row, 'is-error');
      showError(message);
      setTimeout(() => {
        clearOtpBoxes();
        otpBoxes()[0].focus();
      }, 650);
    }

    async function handleVerifyCode(e) {
      e.preventDefault();
      if (otpVerifying) return;
      const code = otpBoxes().map(box => box.value).join('');
      if (!/^\d{6}$/.test(code)) {
        showOtpError('Enter all 6 digits of the code.');
        return;
      }
      hideError();
      otpVerifying = true;
      const button = document.getElementById('otpSubmit');
      button.classList.add('is-busy');
      button.textContent = 'Verifying…';
      try {
        const res = await fetch('/api/auth/verify-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ code })
        });
        const data = await res.json();
        if (data.success && data.user) {
          clearInterval(otpCountdownTimer);
          document.activeElement?.blur();
          document.getElementById('otpForm').classList.add('is-success');
          button.textContent = 'Verified';
          showNotice(data.message);
          setTimeout(() => finishSignIn(data.user), 1100);
          return;
        }
        showOtpError(data.message || 'That code did not work. Please try again.');
      } catch (err) {
        showOtpError('Network error while checking the code.');
      }
      otpVerifying = false;
      button.classList.remove('is-busy');
      button.textContent = 'Verify';
    }

    function startResendCountdown(seconds) {
      const button = document.getElementById('otpResend');
      clearInterval(otpCountdownTimer);
      let remaining = Math.max(0, Math.ceil(seconds));
      const render = () => {
        button.disabled = remaining > 0;
        button.textContent = remaining > 0
          ? `Resend in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
          : 'Resend code';
      };
      render();
      otpCountdownTimer = setInterval(() => {
        remaining -= 1;
        render();
        if (remaining <= 0) clearInterval(otpCountdownTimer);
      }, 1000);
    }

    async function resendCode() {
      hideError();
      const button = document.getElementById('otpResend');
      button.disabled = true;
      try {
        const res = await fetch('/api/auth/resend-code', { method: 'POST', credentials: 'same-origin' });
        const data = await res.json();
        if (data.success) {
          clearOtpBoxes();
          restartAnimation(document.querySelector('#otpForm .otp-mail'), 'is-resent');
          if (data.emailSent === false) showError(data.message);
          else showNotice(data.message);
          startResendCountdown(data.resendAfter || 60);
          otpBoxes()[0].focus();
        } else {
          showError(data.message || 'Could not send a new code.');
          startResendCountdown(data.retryAfter || 0);
        }
      } catch (err) {
        showError('Network error while sending a new code.');
        button.disabled = false;
      }
    }

    async function handleRegister(e) {
      e.preventDefault();
      if (authRequestBusy) return;
      hideError();
      updatePasswordRequirements();

      if (document.getElementById('registerSubmit').disabled) {
        showError('Please meet all password requirements before registering.');
        return;
      }

      await runWhileBusy('registerSubmit', 'Creating account…', submitRegistration);
      // The button's enabled state follows the password rules again.
      updatePasswordRequirements();
    }

    async function submitRegistration() {
      const fullName = document.getElementById('regFullName').value.trim();
      const email = document.getElementById('regEmail').value.trim();
      const password = document.getElementById('regPassword').value;

      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ fullName, email, password })
        });

        const data = await res.json();
        if (data.success) {
          // The new account is confirmed with the emailed code, which also signs in.
          document.getElementById('registerForm').reset();
          updatePasswordRequirements();
          document.getElementById('loginEmail').value = email;
          showOtpStep(data, 'registerForm');
        } else {
          showError(data.message || (data.errors ? data.errors.join(' ') : 'Registration failed.'));
        }
      } catch (err) {
        showError('Network error connecting to registration service.');
      }
    }

    document.getElementById('regPassword').addEventListener('input', updatePasswordRequirements);
    updatePasswordRequirements();
    setupOtpBoxes();
    showVerificationResult();
    if (openResetFromLink()) document.body.classList.remove('auth-checking');
    else redirectAuthenticatedUser();
    window.addEventListener('pageshow', event => {
      if (event.persisted && !passwordResetToken) redirectAuthenticatedUser();
    });
