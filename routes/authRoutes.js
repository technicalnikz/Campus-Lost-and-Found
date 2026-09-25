// routes/authRoutes.js - User Authentication, Registration, and Session Management
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { validateUserAuth, sanitizeString } = require('../middleware/validate');

const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');

function getUsers() {
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

// POST /api/auth/register
router.post('/register', validateUserAuth, async (req, res) => {
  try {
    const { email, password, fullName, studentId, department } = req.body;
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
      department: sanitizeString(department) || 'College of Computer Studies (CCS)',
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    saveUsers(users);

    // Auto-login session
    req.session.user = {
      id: newUser.id,
      email: newUser.email,
      fullName: newUser.fullName,
      role: newUser.role,
      department: newUser.department,
      studentId: newUser.studentId
    };

    res.status(201).json({
      success: true,
      message: 'Account registered successfully.',
      user: req.session.user
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

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.'
      });
    }

    req.session.user = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      department: user.department,
      studentId: user.studentId
    };

    res.json({
      success: true,
      message: 'Login successful.',
      user: req.session.user
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
    res.clearCookie('connect.sid');
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

module.exports = router;
