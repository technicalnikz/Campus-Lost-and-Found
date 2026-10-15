// routes/authRoutes.js - User Authentication, Registration, and Session Management
const express = require('express');
const router = express.Router();
const path = require('path');
const bcrypt = require('bcryptjs');
const { validateUserAuth, sanitizeString } = require('../middleware/validate');
const { sendRegistrationEmail } = require('../services/email');
const { readJsonArray, writeJsonArray } = require('../services/jsonStore');
const postgresStore = require('../services/postgresStore');

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
    if (!/^[^\s@]+@cspc\.edu\.ph$/.test(adminEmail)) {
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
    if (!email.endsWith('@my.cspc.edu.ph')) {
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
    const users = getUsers();

    const existing = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email address already exists.'
      });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = {
      id: 'usr-' + Date.now(),
      email,
      passwordHash,
      fullName: sanitizeString(fullName) || 'CSPC Student',
      studentId: sanitizeString(studentId) || 'N/A',
      role: 'student', // default self-registration is student role
      department: sanitizeString(department),
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    saveUsers(users);

    const sessionUser = {
      id: newUser.id,
      email: newUser.email,
      fullName: newUser.fullName,
      role: newUser.role,
      department: newUser.department,
      studentId: newUser.studentId
    };
    await authenticateSession(req, sessionUser);

    let emailSent = false;
    try {
      await sendRegistrationEmail(newUser);
      emailSent = true;
    } catch (error) {
      console.error('Registration confirmation email could not be sent:', error.message);
    }

    res.status(201).json({
      success: true,
      message: emailSent
        ? 'Account registered successfully. A confirmation email has been sent.'
        : 'Account registered successfully, but the confirmation email could not be sent. Please contact support.',
      emailSent,
      user: sessionUser
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error during registration.'
    });
  }
});

// POST /api/auth/login
router.post('/login', validateUserAuth, async (req, res) => {
  try {
    const { email, password } = req.body;
    const users = getUsers();

    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.'
      });
    }

    const expectedDomain = user.role === 'student' ? '@my.cspc.edu.ph' : '@cspc.edu.ph';
    if (!email.endsWith(expectedDomain)) {
      return res.status(401).json({
        success: false,
        message: 'Use the email domain assigned to your account role.'
      });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.'
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

router.ensureDefaultAdminAccount = ensureDefaultAdminAccount;

module.exports = router;
