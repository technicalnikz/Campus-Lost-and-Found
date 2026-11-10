// routes/authRoutes.js - User Authentication, Registration, and Session Management
const express = require('express');
const router = express.Router();
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { validateUserAuth, sanitizeString, passwordStrengthErrors, STUDENT_EMAIL, STAFF_EMAIL } = require('../middleware/validate');
const { sendVerificationCodeEmail, sendPasswordResetEmail } = require('../services/email');
const { readJsonArray, writeJsonArray } = require('../services/jsonStore');
const postgresStore = require('../services/postgresStore');
const { requireAuth, requireRole } = require('../middleware/auth');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const STUDENT_DEPARTMENTS = new Set([
  'College of Computer Studies (CCS)',
  'College of Engineering and Architecture (CEA)',
  'College of Health Sciences (CHS)',
  'College of Tourism, Hospitality and Business Management (CTHBM)',
  'College of Technological and Developmental Education (CTDE)',
  'College of Arts and Sciences (CAS)'
]);

const VERIFICATION_RESEND_MS = 2 * 60 * 1000;
// Emailed one-time codes (sign-up confirmation and every sign-in).
// A code lasts 1 minute; "Resend code" unlocks at the same moment it expires.
const OTP_TTL_MS = 60 * 1000;
const OTP_RESEND_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const LOGIN_LIMIT = { max: 8, windowMs: 15 * 60 * 1000 };
const REGISTRATION_LIMIT = { max: 5, windowMs: 60 * 60 * 1000 };
const RESET_REQUEST_LIMIT = { max: 5, windowMs: 60 * 60 * 1000 };
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('timing-equalizer-not-a-real-password', 10);
const loginFailures = new Map();
const registrationAttempts = new Map();
const resetRequests = new Map();

// In-memory fixed-window counters; enough for a single app instance.
function isRateLimited(store, key, limit) {
  const entry = store.get(key);
  if (!entry) return false;
  if (Date.now() - entry.start > limit.windowMs) {
    store.delete(key);
    return false;
  }
  return entry.count >= limit.max;
}

function recordAttempt(store, key, limit) {
  const entry = store.get(key);
  if (!entry || Date.now() - entry.start > limit.windowMs) {
    if (store.size > 10000) store.clear();
    store.set(key, { start: Date.now(), count: 1 });
  } else {
    entry.count += 1;
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function issuePasswordResetToken() {
  const value = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  return {
    value,
    fields: {
      passwordResetTokenHash: hashToken(value),
      passwordResetExpiresAt: new Date(now + PASSWORD_RESET_TTL_MS).toISOString(),
      passwordResetSentAt: new Date(now).toISOString()
    }
  };
}

function clearPasswordReset(user) {
  delete user.passwordResetTokenHash;
  delete user.passwordResetExpiresAt;
  delete user.passwordResetSentAt;
}

function minimumPasswordLength(user) {
  return user.role === 'admin' ? 12 : 8;
}

async function deliverAccountEmail(send, user, token, devPath) {
  try {
    await send(user, token);
    return true;
  } catch (error) {
    console.error('Account email could not be sent:', error.message);
    if (process.env.NODE_ENV !== 'production') {
      // Local development without SMTP: print the link so the flow can still be completed.
      const base = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
      console.info(`Development link for ${user.email}: ${base}${devPath}${token}`);
    }
    return false;
  }
}

function deliverPasswordResetEmail(user, token) {
  return deliverAccountEmail(sendPasswordResetEmail, user, token, '/login?reset=');
}

// ── One-time codes ──────────────────────────────────────────────────────────
// A pending code lives in the visitor's (server-side) session, so it only works in
// the browser that entered the password. Only its hash is kept.
let generateOtpCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

// Tests make codes predictable; this refuses to run anywhere else.
function setOtpCodeGeneratorForTests(generator) {
  if (process.env.NODE_ENV !== 'test') throw new Error('OTP code generator can only be replaced in tests.');
  generateOtpCode = generator;
}

// Changes when the password does, so a pending code dies if the password changes
// or an unconfirmed sign-up is re-registered by someone else.
function accountFingerprint(user) {
  return hashToken(`${user.id}|${user.passwordHash}`);
}

async function deliverOtpEmail(user, code, purpose) {
  try {
    await sendVerificationCodeEmail(user, code, purpose, OTP_TTL_MS / 60000);
    return true;
  } catch (error) {
    console.error('Verification code email could not be sent:', error.message);
    if (process.env.NODE_ENV !== 'production') {
      // Local development without SMTP: print the code so the flow can still be completed.
      console.info(`Development ${purpose} code for ${user.email}: ${code}`);
    }
    return false;
  }
}

// Issues a new code for this session and emails it. purpose: 'signup' | 'login'.
async function startOtp(req, user, purpose) {
  const code = generateOtpCode();
  const now = Date.now();
  req.session.otp = {
    purpose,
    userId: user.id,
    fingerprint: accountFingerprint(user),
    codeHash: hashToken(code),
    expiresAt: now + OTP_TTL_MS,
    sentAt: now,
    attempts: 0
  };
  return deliverOtpEmail(user, code, purpose);
}

function otpResponse(user, purpose, emailSent) {
  const resendAfter = Math.ceil(OTP_RESEND_MS / 1000);
  return {
    otpRequired: true,
    purpose,
    email: user.email,
    emailSent,
    resendAfter,
    message: emailSent
      ? `We sent a 6-digit code to ${user.email}.`
      : `We could not send the code to ${user.email}. Try "Resend code" in ${resendAfter} seconds.`
  };
}

function sessionUserFor(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    department: user.department,
    studentId: user.studentId
  };
}

function authenticateSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(error => {
      if (error) return reject(error);
      req.session.user = user;
      req.session.save(saveError => {
        if (saveError) return reject(saveError);
        resolve();
      });
    });
  });
}

function getUsers() {
  return readJsonArray(USERS_FILE);
}

function saveUsers(users) {
  writeJsonArray(USERS_FILE, users);
}

function ensureDefaultAdminAccount() {
  const ensureAccount = () => {
    const users = getUsers();
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@cspc.edu.ph').trim().toLowerCase();
    if (!STAFF_EMAIL.test(adminEmail)) {
      throw new Error('ADMIN_EMAIL must be a valid @cspc.edu.ph address.');
    }

    const existingAdmin = users.find(user => user.email.toLowerCase() === adminEmail);
    if (existingAdmin) {
      if (existingAdmin.role !== 'admin') {
        throw new Error(`${adminEmail} is reserved for the administrator account.`);
      }
      if (process.env.NODE_ENV === 'production' && process.env.ADMIN_PASSWORD_RESET === 'true') {
        const password = process.env.ADMIN_PASSWORD;
        if (!password || password.length < 12) {
          throw new Error('ADMIN_PASSWORD must be configured with at least 12 characters to reset the production admin password.');
        }

        existingAdmin.passwordHash = bcrypt.hashSync(password, 10);
        saveUsers(users);
        console.info(`Production admin password reset completed for ${adminEmail}. Set ADMIN_PASSWORD_RESET=false after verifying login.`);
      }
      return;
    }

    const password = process.env.ADMIN_PASSWORD;
    if (process.env.NODE_ENV === 'production' && (!password || password.length < 12)) {
      throw new Error('ADMIN_PASSWORD must be configured with at least 12 characters in production.');
    }

    users.push({
      id: `usr-admin-${Date.now()}`,
      email: adminEmail,
      passwordHash: bcrypt.hashSync(password || 'admin@_123bAck2u', 10),
      fullName: sanitizeString(process.env.ADMIN_NAME || 'CSPC Administrator'),
      studentId: 'N/A',
      role: 'admin',
      department: 'Administration',
      createdAt: new Date().toISOString()
    });
    saveUsers(users);
  };

  if (postgresStore.isConfigured()) return postgresStore.withTransaction(ensureAccount);
  return ensureAccount();
}

// POST /api/auth/register
router.post('/register', validateUserAuth, async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    if (!STUDENT_EMAIL.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Student registration requires an @my.cspc.edu.ph email address.'
      });
    }
    if (isRateLimited(registrationAttempts, req.ip, REGISTRATION_LIMIT)) {
      return res.status(429).json({
        success: false,
        message: 'Too many registrations from this network. Please try again later.'
      });
    }
    const users = getUsers();

    // An unconfirmed registration can be replaced: only whoever owns the inbox can
    // enter the emailed code, so squatting on someone's address achieves nothing.
    const existingIndex = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
    if (existingIndex !== -1 && users[existingIndex].emailVerified !== false) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email address already exists.'
      });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = {
      id: existingIndex === -1 ? 'usr-' + Date.now() : users[existingIndex].id,
      email,
      passwordHash,
      fullName: sanitizeString(fullName) || 'CSPC Student',
      // Self-registration no longer asks for a student ID or department.
      studentId: 'N/A',
      role: 'student', // default self-registration is student role
      department: '',
      emailVerified: false,
      createdAt: new Date().toISOString()
    };

    if (existingIndex === -1) users.push(newUser);
    else users[existingIndex] = newUser;
    saveUsers(users);
    recordAttempt(registrationAttempts, req.ip, REGISTRATION_LIMIT);

    const emailSent = await startOtp(req, newUser, 'signup');
    res.status(201).json({
      success: true,
      verificationRequired: true,
      ...otpResponse(newUser, 'signup', emailSent)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error during registration.'
    });
  }
});

// GET /api/auth/verify-email?token=... - Confirmation links emailed before sign-up
// switched to codes. New accounts get a code instead; this keeps older links working.
router.get('/verify-email', (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!/^[a-f0-9]{64}$/.test(token)) return res.redirect(302, '/login?verified=invalid');

  const users = getUsers();
  const tokenHash = hashToken(token);
  const user = users.find(u => u.emailVerified === false && u.verificationTokenHash === tokenHash);
  if (!user) return res.redirect(302, '/login?verified=invalid');
  if (Date.parse(user.verificationExpiresAt) < Date.now()) return res.redirect(302, '/login?verified=expired');

  user.emailVerified = true;
  user.emailVerifiedAt = new Date().toISOString();
  delete user.verificationTokenHash;
  delete user.verificationExpiresAt;
  delete user.verificationSentAt;
  saveUsers(users);
  res.redirect(302, '/login?verified=success');
});

// POST /api/auth/login
router.post('/login', validateUserAuth, async (req, res) => {
  try {
    const { email, password } = req.body;
    const attemptKey = `${req.ip}|${email}`;
    if (isRateLimited(loginFailures, attemptKey, LOGIN_LIMIT)) {
      return res.status(429).json({
        success: false,
        message: 'Too many failed sign-in attempts. Please wait 15 minutes and try again.'
      });
    }

    const users = getUsers();
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());

    // Students may only use @my.cspc.edu.ph; @cspc.edu.ph is reserved for admin accounts.
    const domainAllowed = Boolean(user) && (user.role === 'admin' ? STAFF_EMAIL.test(email) : STUDENT_EMAIL.test(email));
    // Always run bcrypt so response time does not reveal whether the account exists.
    const isMatch = await bcrypt.compare(password, domainAllowed ? user.passwordHash : DUMMY_PASSWORD_HASH);
    if (!domainAllowed || !isMatch) {
      recordAttempt(loginFailures, attemptKey, LOGIN_LIMIT);
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.'
      });
    }
    loginFailures.delete(attemptKey);

    // Correct password: the emailed code is the second step. An unconfirmed account
    // gets a sign-up code instead, which confirms the email and signs in at once.
    // A code sent to this browser in the last minute is reused instead of re-sent.
    const purpose = user.emailVerified === false ? 'signup' : 'login';
    const pending = req.session.otp;
    const reusable = pending && pending.userId === user.id && pending.purpose === purpose &&
      pending.fingerprint === accountFingerprint(user) &&
      Date.now() - pending.sentAt < OTP_RESEND_MS && pending.attempts < OTP_MAX_ATTEMPTS;
    const emailSent = reusable ? true : await startOtp(req, user, purpose);
    const body = otpResponse(user, purpose, emailSent);

    if (purpose === 'signup') {
      return res.status(403).json({ success: false, code: 'EMAIL_NOT_VERIFIED', ...body,
        message: `Please confirm your email first. ${body.message}` });
    }
    res.json({ success: true, ...body });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error during login.'
    });
  }
});

// POST /api/auth/verify-code - Second step: the 6-digit code emailed by /register or /login.
router.post('/verify-code', async (req, res) => {
  try {
    const pending = req.session.otp;
    if (!pending) {
      return res.status(400).json({ success: false, code: 'OTP_MISSING',
        message: 'This code is no longer valid. Go back and sign in again to get a new one.' });
    }
    if (Date.now() > pending.expiresAt || pending.attempts >= OTP_MAX_ATTEMPTS) {
      return res.status(400).json({ success: false, code: 'OTP_EXPIRED',
        message: 'This code has expired. Tap "Resend code" to get a new one.' });
    }
    const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, code: 'OTP_FORMAT', message: 'Enter the 6-digit code from the email.' });
    }

    const users = getUsers();
    const user = users.find(u => u.id === pending.userId);
    if (!user || accountFingerprint(user) !== pending.fingerprint) {
      delete req.session.otp;
      return res.status(400).json({ success: false, code: 'OTP_MISSING',
        message: 'This code is no longer valid. Go back and sign in again to get a new one.' });
    }

    pending.attempts += 1;
    const matches = crypto.timingSafeEqual(Buffer.from(hashToken(code), 'hex'), Buffer.from(pending.codeHash, 'hex'));
    if (!matches) {
      const attemptsLeft = OTP_MAX_ATTEMPTS - pending.attempts;
      return res.status(400).json({
        success: false,
        code: attemptsLeft > 0 ? 'OTP_INVALID' : 'OTP_EXPIRED',
        attemptsLeft,
        message: attemptsLeft > 0
          ? `That code is not right. ${attemptsLeft} ${attemptsLeft === 1 ? 'try' : 'tries'} left.`
          : 'Too many wrong codes. Tap "Resend code" to get a new one.'
      });
    }

    if (pending.purpose === 'signup' && user.emailVerified === false) {
      user.emailVerified = true;
      user.emailVerifiedAt = new Date().toISOString();
      delete user.verificationTokenHash;
      delete user.verificationExpiresAt;
      delete user.verificationSentAt;
      saveUsers(users);
    }

    // A new session id for the signed-in session; the pending code goes with the old one.
    const sessionUser = sessionUserFor(user);
    await authenticateSession(req, sessionUser);
    res.json({
      success: true,
      message: pending.purpose === 'signup' ? 'Your email is confirmed. Welcome to Back2You!' : 'Login successful.',
      user: sessionUser
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error during verification.' });
  }
});

// POST /api/auth/resend-code - New code for the sign-up or sign-in waiting in this session.
router.post('/resend-code', async (req, res) => {
  try {
    const pending = req.session.otp;
    if (!pending) {
      return res.status(400).json({ success: false, code: 'OTP_MISSING',
        message: 'Go back and sign in again to get a new code.' });
    }
    const waitMs = OTP_RESEND_MS - (Date.now() - pending.sentAt);
    if (waitMs > 0) {
      const retryAfter = Math.ceil(waitMs / 1000);
      return res.status(429).json({ success: false, retryAfter,
        message: `Please wait ${retryAfter} seconds before requesting another code.` });
    }
    const user = getUsers().find(u => u.id === pending.userId);
    if (!user || accountFingerprint(user) !== pending.fingerprint) {
      delete req.session.otp;
      return res.status(400).json({ success: false, code: 'OTP_MISSING',
        message: 'Go back and sign in again to get a new code.' });
    }
    const emailSent = await startOtp(req, user, pending.purpose);
    res.json({ success: true, ...otpResponse(user, pending.purpose, emailSent),
      message: emailSent ? `We sent a new code to ${user.email}.` : 'We could not send a new code. Please try again in a minute.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error while sending the code.' });
  }
});

// POST /api/auth/forgot-password - Email a one-hour reset link.
// The reply is identical whether or not the account exists.
router.post('/forgot-password', async (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!STUDENT_EMAIL.test(email) && !STAFF_EMAIL.test(email)) {
    return res.status(400).json({ success: false, message: 'Use your CSPC email address ending in @my.cspc.edu.ph.' });
  }
  if (isRateLimited(resetRequests, req.ip, RESET_REQUEST_LIMIT)) {
    return res.status(429).json({ success: false, message: 'Too many reset requests. Please try again later.' });
  }
  recordAttempt(resetRequests, req.ip, RESET_REQUEST_LIMIT);

  try {
    const users = getUsers();
    const user = users.find(u => u.email.toLowerCase() === email);
    const lastSent = Date.parse(user?.passwordResetSentAt) || 0;
    if (user && Date.now() - lastSent > VERIFICATION_RESEND_MS) {
      const token = issuePasswordResetToken();
      Object.assign(user, token.fields);
      saveUsers(users);
      await deliverPasswordResetEmail(user, token.value);
    }
    res.json({
      success: true,
      message: `If an account exists for ${email}, a password reset link has been sent. The link expires in 1 hour.`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Could not process the reset request.' });
  }
});

// POST /api/auth/reset-password - Set a new password using the emailed link.
router.post('/reset-password', async (req, res) => {
  const token = typeof req.body.token === 'string' ? req.body.token : '';
  const invalid = () => res.status(400).json({
    success: false,
    code: 'RESET_LINK_INVALID',
    message: 'This reset link is invalid or has expired. Please request a new one.'
  });
  if (!/^[a-f0-9]{64}$/.test(token)) return invalid();

  try {
    const users = getUsers();
    const tokenHash = hashToken(token);
    const user = users.find(u => u.passwordResetTokenHash === tokenHash);
    if (!user || Date.parse(user.passwordResetExpiresAt) < Date.now()) return invalid();

    const errors = passwordStrengthErrors(req.body.password, minimumPasswordLength(user));
    if (errors.length) return res.status(400).json({ success: false, message: errors.join(' '), errors });

    user.passwordHash = await bcrypt.hash(req.body.password, 10);
    user.passwordChangedAt = new Date().toISOString();
    clearPasswordReset(user);
    // Opening the emailed link proves the student owns the inbox.
    if (user.emailVerified === false) {
      user.emailVerified = true;
      user.emailVerifiedAt = user.passwordChangedAt;
      delete user.verificationTokenHash;
      delete user.verificationExpiresAt;
      delete user.verificationSentAt;
    }
    saveUsers(users);
    loginFailures.forEach((entry, key) => {
      if (key.endsWith(`|${user.email}`)) loginFailures.delete(key);
    });
    res.json({ success: true, message: 'Your password has been changed. You can now sign in.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Could not reset the password.' });
  }
});

// POST /api/auth/change-password - Signed-in users change their own password.
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const attemptKey = `${req.ip}|${req.session.user.email}`;
  if (isRateLimited(loginFailures, attemptKey, LOGIN_LIMIT)) {
    return res.status(429).json({ success: false, message: 'Too many incorrect attempts. Please wait 15 minutes and try again.' });
  }

  try {
    const users = getUsers();
    const user = users.find(u => String(u.id) === String(req.session.user.id));
    if (!user) return res.status(401).json({ success: false, message: 'Authentication required. Please log in.' });

    const currentMatches = typeof currentPassword === 'string'
      && await bcrypt.compare(currentPassword, user.passwordHash);
    if (!currentMatches) {
      recordAttempt(loginFailures, attemptKey, LOGIN_LIMIT);
      return res.status(400).json({ success: false, message: 'Your current password is incorrect.' });
    }

    const errors = passwordStrengthErrors(newPassword, minimumPasswordLength(user));
    if (newPassword === currentPassword) errors.push('Choose a password different from your current one.');
    if (errors.length) return res.status(400).json({ success: false, message: errors.join(' '), errors });

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.passwordChangedAt = new Date().toISOString();
    clearPasswordReset(user);
    saveUsers(users);
    loginFailures.delete(attemptKey);
    // New session ID so a previously captured session cookie stops working.
    await authenticateSession(req, req.session.user);
    res.json({ success: true, message: 'Your password has been changed.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Could not change the password.' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Could not log out.' });
    }
    res.clearCookie('cspc.sid');
    res.json({ success: true, message: 'Logged out successfully.' });
  });
});

// GET /api/auth/me (Current Session Check)
router.get('/me', (req, res) => {
  if (req.session && req.session.user) {
    return res.json({
      authenticated: true,
      user: req.session.user
    });
  }
  res.json({
    authenticated: false,
    user: null
  });
});

// GET /api/auth/users - Admin-only user directory (never expose password hashes).
router.get('/users', requireRole('admin'), (req, res) => {
  const users = getUsers().map(({
    passwordHash, verificationTokenHash, verificationExpiresAt, verificationSentAt,
    passwordResetTokenHash, passwordResetExpiresAt, passwordResetSentAt, ...user
  }) => user);
  res.json({ success: true, users });
});

// POST /api/auth/users - Admin-only user creation.
router.post('/users', requireRole('admin'), async (req, res) => {
  try {
    const fullName = sanitizeString(req.body.fullName);
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const role = req.body.role === 'admin' ? 'admin' : 'student';
    const studentId = sanitizeString(req.body.studentId) || 'N/A';
    const department = sanitizeString(req.body.department) || (role === 'admin' ? 'Administration' : '');
    const errors = [];

    if (!fullName || fullName.length < 2 || fullName.length > 100) errors.push('Full name must be between 2 and 100 characters.');
    if ((role === 'student' && !STUDENT_EMAIL.test(email)) || (role === 'admin' && !STAFF_EMAIL.test(email))) {
      errors.push(role === 'student' ? 'Student accounts must use an @my.cspc.edu.ph email.' : 'Admin accounts must use an @cspc.edu.ph email.');
    }
    if (passwordStrengthErrors(password, role === 'admin' ? 12 : 8).length) {
      errors.push(`Password must be at least ${role === 'admin' ? 12 : 8} characters and include uppercase, lowercase, number, and special character.`);
    }
    if (role === 'student' && !STUDENT_DEPARTMENTS.has(department)) errors.push('Select a valid college department.');
    if (role === 'admin' && department !== 'Administration') errors.push('Admin accounts must use the Administration department.');

    const users = getUsers();
    if (users.some(user => user.email.toLowerCase() === email)) errors.push('An account with this email address already exists.');
    if (errors.length) return res.status(400).json({ success: false, message: 'User validation failed.', errors });

    const newUser = {
      id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      email,
      passwordHash: await bcrypt.hash(password, 10),
      fullName,
      studentId,
      role,
      department,
      createdAt: new Date().toISOString()
    };
    users.push(newUser);
    saveUsers(users);
    const { passwordHash, ...safeUser } = newUser;
    res.status(201).json({ success: true, message: 'User created successfully.', user: safeUser });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Could not create user.' });
  }
});

// DELETE /api/auth/users/:id - Admin-only user deletion.
router.delete('/users/:id', requireRole('admin'), (req, res) => {
  const users = getUsers();
  const index = users.findIndex(user => String(user.id) === String(req.params.id));
  if (index === -1) return res.status(404).json({ success: false, message: 'User not found.' });

  const target = users[index];
  if (target.id === req.session.user.id) return res.status(400).json({ success: false, message: 'You cannot delete the account currently in use.' });
  if (target.role === 'admin' && users.filter(user => user.role === 'admin').length <= 1) {
    return res.status(400).json({ success: false, message: 'The last administrator account cannot be deleted.' });
  }

  users.splice(index, 1);
  saveUsers(users);
  res.json({ success: true, message: 'User deleted successfully.' });
});

router.ensureDefaultAdminAccount = ensureDefaultAdminAccount;
router.setOtpCodeGeneratorForTests = setOtpCodeGeneratorForTests;

module.exports = router;
