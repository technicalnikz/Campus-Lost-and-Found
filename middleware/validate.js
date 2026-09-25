// middleware/validate.js - Server-side Input Validation & Sanitization

const ALLOWED_CATEGORIES = [
  'Electronics',
  'ID / Cards',
  'Bags & Wallets',
  'Books & Documents',
  'Keys',
  'Clothing & Accessories',
  'Others'
];

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
  req.body.locationDetails = sanitizeString(req.body.locationDetails || '');
  req.body.verification = sanitizeString(req.body.verification || '');
  req.body.photo = (req.body.photo && typeof req.body.photo === 'string' && req.body.photo.startsWith('data:image/'))
    ? req.body.photo
    : '';

  next();
}

function validateUserAuth(req, res, next) {
  const { email, password } = req.body;
  const errors = [];

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email.trim())) {
    errors.push('A valid email address is required.');
  }

  if (!password || password.length < 6) {
    errors.push('Password must be at least 6 characters long.');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Authentication input validation failed',
      errors
    });
  }

  req.body.email = email.trim().toLowerCase();
  next();
}

module.exports = {
  validateItemReport,
  validateUserAuth,
  sanitizeString
};
