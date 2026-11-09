// middleware/validate.js - Server-side Input Validation & Sanitization

const ALLOWED_CATEGORIES = [
  'Electronics',
  'ID / Cards',
  'Bags & Wallets',
  'Books & Documents',
  'Keys',
  'Clothing & Accessories',
  'Jewelry',
  'Sports Equipment',
  'School Supplies',
  'Others'
];

// Exact CSPC addresses: no subdomains, spaces, or extra @ signs.
const STUDENT_EMAIL = /^[a-z0-9._%+-]+@my\.cspc\.edu\.ph$/;
const STAFF_EMAIL = /^[a-z0-9._%+-]+@cspc\.edu\.ph$/;

function sanitizeString(str) {
  if (typeof str !== 'string') return '';
  return str
    .trim()
    .replace(/[<>]/g, ''); // strip script injection tags
}

function validateItemReport(req, res, next) {
  const { title, category, type, location, contact, desc } = req.body;
  const errors = [];

  const cleanTitle = sanitizeString(title);
  const cleanCategory = sanitizeString(category);
  const cleanType = sanitizeString(type);
  const cleanLocation = sanitizeString(location);
  const cleanContact = sanitizeString(contact);
  const cleanDesc = sanitizeString(desc);
  const cleanVerification = sanitizeString(req.body.verification || '');
  const cleanLocationDetails = sanitizeString(req.body.locationDetails || '');

  if (!cleanTitle || cleanTitle.length < 3 || cleanTitle.length > 100) {
    errors.push('Item name must be between 3 and 100 characters.');
  }

  if (!cleanCategory || !ALLOWED_CATEGORIES.includes(cleanCategory)) {
    errors.push('Please select a valid item category from the list.');
  }

  if (!cleanType || !['lost', 'found'].includes(cleanType)) {
    errors.push("Report type must be either 'lost' or 'found'.");
  }

  if (!cleanLocation || cleanLocation.length < 3 || cleanLocation.length > 150) {
    errors.push('Campus location is required and must specify an official CSPC office or area.');
  }

  if (!cleanContact || cleanContact.length < 5 || cleanContact.length > 100) {
    errors.push('Contact information (name and phone/email) must be provided.');
  }

  if (!cleanDesc || cleanDesc.length < 5 || cleanDesc.length > 500) {
    errors.push('Description must be between 5 and 500 characters.');
  }
  if (cleanVerification.length > 250 || cleanLocationDetails.length > 150) {
    errors.push('Additional report details are too long.');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  // Attach sanitized fields to req.body
  req.body.title = cleanTitle;
  req.body.category = cleanCategory;
  req.body.type = cleanType;
  req.body.location = cleanLocation;
  req.body.contact = cleanContact;
  req.body.desc = cleanDesc;
  req.body.locationDetails = cleanLocationDetails;
  req.body.verification = cleanVerification;
  delete req.body.photo;

  next();
}

// Shared by registration, password reset, and password change.
function passwordStrengthErrors(password, minLength = 8) {
  const value = typeof password === 'string' ? password : '';
  const errors = [];
  if (value.length < minLength) {
    errors.push(`Password must be at least ${minLength} characters long.`);
  }
  if (value.length > 128) {
    errors.push('Password must be at most 128 characters long.');
  }
  if (!/[A-Z]/.test(value)) {
    errors.push('Password must contain one uppercase letter (A-Z).');
  }
  if (!/[a-z]/.test(value)) {
    errors.push('Password must contain one lowercase letter (a-z).');
  }
  if (!/[0-9]/.test(value)) {
    errors.push('Password must contain one number (0-9).');
  }
  if (!/[!@#$%?&*]/.test(value)) {
    errors.push('Password must contain one special symbol (!, @, #, $, %, ?, &, *).');
  }
  return errors;
}

function validateUserAuth(req, res, next) {
  const { email, password } = req.body;
  const errors = [];

  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (req.path === '/register') {
    // Self-registration is for students only.
    if (!STUDENT_EMAIL.test(normalizedEmail)) {
      errors.push('Use your CSPC student email address ending in @my.cspc.edu.ph.');
    }
  } else if (!STUDENT_EMAIL.test(normalizedEmail) && !STAFF_EMAIL.test(normalizedEmail)) {
    errors.push('Use your CSPC email address ending in @my.cspc.edu.ph.');
  }

  if (typeof password !== 'string' || !password) {
    errors.push('Password is required.');
  } else if (password.length > 128) {
    errors.push('Password must be at most 128 characters long.');
  } else if (req.path !== '/register' && password.length < 6) {
    errors.push('Password must be at least 6 characters long.');
  }

  if (req.path === '/register') {
    errors.push(...passwordStrengthErrors(password));
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Authentication input validation failed',
      errors
    });
  }

  req.body.email = normalizedEmail;
  next();
}

module.exports = {
  validateItemReport,
  validateUserAuth,
  sanitizeString,
  passwordStrengthErrors,
  STUDENT_EMAIL,
  STAFF_EMAIL
};
