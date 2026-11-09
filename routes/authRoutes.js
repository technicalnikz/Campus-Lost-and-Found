// routes/authRoutes.js - User Authentication, Registration, and Session Management
const express = require('express');
const router = express.Router();
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { validateUserAuth, sanitizeString, STUDENT_EMAIL, STAFF_EMAIL } = require('../middleware/validate');
const { sendVerificationEmail } = require('../services/email');
const { readJsonArray, writeJsonArray } = require('../services/jsonStore');
const postgresStore = require('../services/postgresStore');
const { requireRole } = require('../middleware/auth');

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

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const VERIFICATION_RESEND_MS = 2 * 60 * 1000;
const LOGIN_LIMIT = { max: 8, windowMs: 15 * 60 * 1000 };
const REGISTRATION_LIMIT = { max: 5, windowMs: 60 * 60 * 1000 };
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('timing-equalizer-not-a-real-password', 10);
const loginFailures = new Map();
const registrationAttempts = new Map();

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

// Only the hash is stored, so a leaked users table cannot be used to verify accounts.
function issueVerificationToken() {
  const value = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  return {
    value,
    fields: {
      verificationTokenHash: hashToken(value),
      verificationExpiresAt: new Date(now + VERIFICATION_TTL_MS).toISOString(),
      verificationSentAt: new Date(now).toISOString()
    }
  };
}

async function deliverVerificationEmail(user, token) {
  try {
    await sendVerificationEmail(user, token);
    return true;
  } catch (error) {
    console.error('Verification email could not be sent:', error.message);
    if (process.env.NODE_ENV !== 'production') {
      // Local development without SMTP: print the link so the account can still be confirmed.
      const base = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
      console.info(`Development verification link for ${user.email}: ${base}/api/auth/verify-email?token=${token}`);
    }
    return false;
  }
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
    const { email, password, fullName, studentId, department } = req.body;
    if (!STUDENT_EMAIL.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Student registration requires an @my.cspc.edu.ph email address.'
      });
    }
    if (!STUDENT_DEPARTMENTS.has(department)) {
      return res.status(400).json({
        success: false,
        message: 'Select a valid college department.'
      });
    }
    if (isRateLimited(registrationAttempts, req.ip, REGISTRATION_LIMIT)) {
      return res.status(429).json({
        success: false,
        message: 'Too many registrations from this network. Please try again later.'
      });
    }
    const users = getUsers();

    // An unconfirmed registration can be replaced: whoever owns the inbox
    // confirms the newest link, so squatting on someone's address achieves nothing.
    const existingIndex = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
    if (existingIndex !== -1 && users[existingIndex].emailVerified !== false) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email address already exists.'
      });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const token = issueVerificationToken();

    const newUser = {
      id: existingIndex === -1 ? 'usr-' + Date.now() : users[existingIndex].id,
      email,
      passwordHash,
      fullName: sanitizeString(fullName) || 'CSPC Student',
      studentId: sanitizeString(studentId) || 'N/A',
      role: 'student', // default self-registration is student role
      department: sanitizeString(department),
      emailVerified: false,
      ...token.fields,
      createdAt: new Date().toISOString()
    };

    if (existingIndex === -1) users.push(newUser);
    else users[existingIndex] = newUser;
    saveUsers(users);
    recordAttempt(registrationAttempts, req.ip, REGISTRATION_LIMIT);

    const emailSent = await deliverVerificationEmail(newUser, token.value);

    res.status(201).json({
      success: true,
      verificationRequired: true,
      message: emailSent
        ? `Almost done! We sent a confirmation link to ${email}. Open it to activate your account, then sign in.`
        : 'Your account was created, but the confirmation email could not be sent. Try signing in later to receive a new confirmation link.',
      emailSent
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error during registration.'
    });
  }
});

// GET /api/auth/verify-email?token=... - Link opened from the confirmation email.
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

    if (user.emailVerified === false) {
      let emailSent = false;
      const lastSent = Date.parse(user.verificationSentAt) || 0;
      if (Date.now() - lastSent > VERIFICATION_RESEND_MS) {
        const token = issueVerificationToken();
        Object.assign(user, token.fields);
        saveUsers(users);
        emailSent = await deliverVerificationEmail(user, token.value);
      }
      return res.status(403).json({
        success: false,
        code: 'EMAIL_NOT_VERIFIED',
        message: emailSent
          ? `Please confirm your email first. We sent a new confirmation link to ${user.email}.`
          : `Please confirm your email first using the link sent to ${user.email}. You can request a new link by signing in again in a few minutes.`
      });
    }

    const sessionUser = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      department: user.department,
      studentId: user.studentId
    };
    await authenticateSession(req, sessionUser);

    res.json({
      success: true,
      message: 'Login successful.',
      user: sessionUser
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error during login.'
    });
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
  const users = getUsers().map(({ passwordHash, verificationTokenHash, verificationExpiresAt, verificationSentAt, ...user }) => user);
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
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[!@#$%?&*]/.test(password)) {
      errors.push('Password must be at least 8 characters and include uppercase, lowercase, number, and special character.');
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

module.exports = router;
