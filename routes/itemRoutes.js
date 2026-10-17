// routes/itemRoutes.js - Item Management, Smart Matching, and Claim Handlers
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { validateItemReport, sanitizeString } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { readJsonArray, writeJsonArray } = require('../services/jsonStore');
const {
  sendPossibleMatchEmail,
  sendClaimStatusEmail,
  sendClaimRequestEmail,
  sendFinderNotificationEmail,
  sendBroadcastEmail
} = require('../services/email');
const postgresStore = require('../services/postgresStore');
const supabaseStorage = require('../services/supabaseStorage');

// res.sendFile requires an absolute path. DATA_DIR is commonly configured as
// a relative value (for example, DATA_DIR=./data) on hosted deployments.
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const ITEMS_FILE = path.join(DATA_DIR, 'items.json');
const CLAIMS_FILE = path.join(DATA_DIR, 'claims.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const IMAGE_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp'
};
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(req, file, callback) {
    if (!IMAGE_EXTENSIONS[file.mimetype]) {
      return callback(Object.assign(new Error('Upload a JPEG, PNG, GIF, or WebP image.'), { status: 400 }));
    }
    callback(null, true);
  }
});

function isValidImage(file) {
  const bytes = file.buffer;
  if (file.mimetype === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (file.mimetype === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (file.mimetype === 'image/gif') return ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6));
  if (file.mimetype === 'image/webp') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

function saveUploadedImageLocally(file) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const filename = `${crypto.randomUUID()}.${IMAGE_EXTENSIONS[file.mimetype]}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), file.buffer, { flag: 'wx' });
  return `/uploads/${filename}`;
}

async function saveUploadedImage(file) {
  if (supabaseStorage.isConfigured()) return supabaseStorage.uploadImage(file);
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY.');
  }
  return saveUploadedImageLocally(file);
}

function publicItemView(item, potentialMatch = null, canResolve = false, canRequestClaim = false) {
  return {
    id: item.id,
    refCode: item.refCode,
    title: item.title,
    category: item.category,
    type: item.type,
    location: item.location,
    desc: item.desc || item.description || '',
    photo: supabaseStorage.objectKey(item.photo)
      ? `/api/items/${encodeURIComponent(item.id)}/photo`
      : (item.photo || item.imageUrl || ''),
    date: item.date,
    createdAt: item.createdAt,
    status: item.status,
    claimed: Boolean(item.claimed),
    claimedAt: item.claimedAt || null,
    canResolve,
    canRequestClaim,
    potentialMatch: potentialMatch ? {
      id: potentialMatch.id,
      title: potentialMatch.title,
      location: potentialMatch.location,
      type: potentialMatch.type
    } : null
  };
}

function getItems() {
  return readJsonArray(ITEMS_FILE);
}

function saveItems(items) {
  writeJsonArray(ITEMS_FILE, items);
}

function isItemClaimed(item) {
  return Boolean(item.claimed || item.status === 'claimed');
}

function getClaims() {
  return readJsonArray(CLAIMS_FILE);
}

function saveClaims(claims) {
  writeJsonArray(CLAIMS_FILE, claims);
}

function addItemActivity(item, req, action, notes = '') {
  if (!Array.isArray(item.activityLog)) item.activityLog = [];
  item.activityLog.unshift({
    id: `activity-${crypto.randomUUID()}`,
    action,
    notes: sanitizeString(notes).slice(0, 500),
    timestamp: new Date().toISOString(),
    actorId: req.session?.user?.id || 'system',
    actorName: req.session?.user?.fullName || req.session?.user?.email || 'System',
    actorRole: req.session?.user?.role || 'system'
  });
  item.activityLog = item.activityLog.slice(0, 100);
}

const MATCH_REFERENCE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function matchReferenceSecret() {
  return process.env.SESSION_SECRET || 'cspc-lostfound-development-only';
}

function createMatchReferenceToken(lostId, foundId, issuedAt = Date.now()) {
  const expiresAt = issuedAt + MATCH_REFERENCE_TTL_MS;
  const payload = `${lostId}.${foundId}.${issuedAt}.${expiresAt}`;
  const signature = crypto.createHmac('sha256', matchReferenceSecret()).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

function parseMatchReferenceToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 5) return null;
  const [lostId, foundId, issuedAtText, expiresAtText, signature] = parts;
  const issuedAt = Number(issuedAtText);
  const expiresAt = Number(expiresAtText);
  if (!lostId || !foundId || !Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) || !signature) return null;

  const payload = `${lostId}.${foundId}.${issuedAt}.${expiresAt}`;
  const expected = crypto.createHmac('sha256', matchReferenceSecret()).update(payload).digest('hex');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return { lostId, foundId, issuedAt, expiresAt };
}

function getMatchReferenceStatus(foundItem, claims) {
  if (isItemClaimed(foundItem) || claims.some(claim => String(claim.itemId) === String(foundItem.id) && claim.status === 'approved')) {
    return { key: 'approved', label: 'Approved for Claim' };
  }
  if (claims.some(claim => String(claim.itemId) === String(foundItem.id) && claim.status === 'pending')) {
    return { key: 'review', label: 'Under Review' };
  }
  return { key: 'pending', label: 'Pending Verification' };
}

// Helper: Smart Match & Reconciliation Detector
function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeText(value) {
  const stopWords = new Set([
    'with', 'case', 'blue', 'black', 'item', 'lost', 'found', 'cspc', 'college',
    'the', 'and', 'for', 'from', 'near', 'this', 'that', 'into', 'onto', 'there',
    'please', 'return', 'owner', 'campus', 'building', 'student', 'report', 'reports'
  ]);

  return normalizeText(value)
    .split(' ')
    .filter(word => word.length > 2 && !stopWords.has(word));
}

function computeTokenSimilarity(a, b) {
  const tokensA = tokenizeText(a);
  const tokensB = tokenizeText(b);

  if (!tokensA.length || !tokensB.length) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const intersection = [...setA].filter(token => setB.has(token)).length;
  const union = new Set([...tokensA, ...tokensB]).size;

  if (union === 0) return 0;

  const jaccard = intersection / union;
  const overlap = intersection / Math.min(tokensA.length, tokensB.length);
  return Math.max(jaccard, overlap);
}

function compareVerificationHints(left, right) {
  const a = normalizeText(left || '');
  const b = normalizeText(right || '');
  if (!a || !b) return 0;

  const tokensA = new Set(tokenizeText(a));
  const tokensB = new Set(tokenizeText(b));
  const overlap = [...tokensA].filter(token => tokensB.has(token)).length;

  return overlap > 0 ? 1 : 0;
}

function scorePotentialMatch(item, other) {
  const categoryMatch = item.category && other.category && item.category === other.category;
  const locationA = normalizeText(item.location);
  const locationB = normalizeText(other.location);
  const sameLocation = !!(locationA && locationB && (
    locationA.includes(locationB.split(' ')[0]) ||
    locationB.includes(locationA.split(' ')[0]) ||
    locationA === locationB
  ));

  const nameSimilarity = computeTokenSimilarity(item.title, other.title);
  const descSimilarity = computeTokenSimilarity(item.desc || item.description || '', other.desc || other.description || '');
  const verificationScore = compareVerificationHints(item.verification, other.verification);

  const categoryWeight = categoryMatch ? 0.46 : 0;
  const nameWeight = Math.max(nameSimilarity, descSimilarity) * 0.33;
  const verificationWeight = verificationScore * 0.18;
  const locationWeight = sameLocation ? 0.08 : 0;
  const score = categoryWeight + nameWeight + verificationWeight + locationWeight;

  return { score, categoryMatch, sameLocation, nameSimilarity, descSimilarity, verificationScore };
}

function isStrongPotentialMatch(meta) {
  const hasStrongNameSimilarity = meta.nameSimilarity >= 0.28;
  const hasStrongDescriptionSimilarity = meta.descSimilarity >= 0.22;
  const hasVerificationOverlap = meta.verificationScore > 0;
  const hasStrongKeywordOverlap =
    (meta.nameSimilarity >= 0.55 && meta.descSimilarity >= 0.35) ||
    (meta.descSimilarity >= 0.55 && meta.nameSimilarity >= 0.35);
  const hasStrongLocationAndKeywordOverlap =
    meta.sameLocation && Math.max(meta.nameSimilarity, meta.descSimilarity) >= 0.55;

  return (
    meta.categoryMatch &&
    (hasStrongNameSimilarity || hasStrongDescriptionSimilarity || hasVerificationOverlap) &&
    meta.score >= 0.58
  ) || (
    !meta.categoryMatch &&
    (hasStrongKeywordOverlap || hasStrongLocationAndKeywordOverlap)
  );
}

function findMatches(item, allItems) {
  if (isItemClaimed(item)) return [];
  const targetType = item.type === 'lost' ? 'found' : 'lost';
  return allItems
    .filter(other =>
      other.id !== item.id &&
      other.type === targetType &&
      !isItemClaimed(other)
    )
    .map(other => ({ item: other, meta: scorePotentialMatch(item, other) }))
    .filter(({ meta }) => isStrongPotentialMatch(meta))
    .sort((a, b) => b.meta.score - a.meta.score)
    .map(({ item: match }) => match);
}

function findMatch(item, allItems) {
  return findMatches(item, allItems)[0] || null;
}

function addMatchLink(item, other, matchedAt) {
  if (!Array.isArray(item.matches)) item.matches = [];
  if (item.matches.some(match => String(match.itemId) === String(other.id))) return;

  item.matches.push({
    itemId: other.id,
    refCode: other.refCode,
    type: other.type,
    status: 'possible',
    matchedAt
  });
}

function createMatchNotification(lostItem, foundItem) {
  const notifications = Array.isArray(lostItem.notifications) ? lostItem.notifications : [];
  if (notifications.some(notification =>
    notification.notificationType === 'match' &&
    String(notification.matchItemId) === String(foundItem.id)
  )) {
    return null;
  }

  const notification = {
    id: `notif-${crypto.randomUUID()}`,
    notificationType: 'match',
    itemTitle: lostItem.title,
    refCode: lostItem.refCode,
    matchItemId: foundItem.id,
    matchItemTitle: foundItem.title,
    matchRefCode: foundItem.refCode,
    matchLocation: foundItem.location,
    message: 'A found item may match your lost-item report. Sign in to review it.',
    timestamp: new Date().toISOString(),
    read: false
  };
  lostItem.notifications = [notification, ...notifications].slice(0, 100);
  return notification;
}

function getStudentReporter(lostItem, users) {
  if (!lostItem.reportedBy || lostItem.reportedBy === 'guest') return null;
  return users.find(user =>
    user.id === lostItem.reportedBy &&
    user.role === 'student' &&
    /^[^\s@]+@my\.cspc\.edu\.ph$/i.test(user.email || '')
  ) || null;
}

/*
 * Persist match references on both reports. Private verification hints stay out
 * of the link records and are never included in notification emails.
 */
function linkMatchedItems(lostItem, foundItem, matchedAt) {
  addMatchLink(lostItem, foundItem, matchedAt);
  addMatchLink(foundItem, lostItem, matchedAt);
}

// GET /api/stats - High-level overview
router.get('/stats', (req, res) => {
  const items = getItems();
  const total = items.length;
  const lost = items.filter(i => i.type === 'lost').length;
  const found = items.filter(i => i.type === 'found').length;
  const claimed = items.filter(i => i.claimed || i.status === 'claimed').length;

  res.json({
    success: true,
    stats: { total, lost, found, claimed }
  });
});

router.get('/claims', requireRole('admin'), (req, res) => {
  const claims = getClaims().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, claims });
});

// POST /api/items/broadcast - Send an admin announcement to registered students.
router.post('/broadcast', requireRole('admin'), async (req, res) => {
  const subject = sanitizeString(req.body.subject || '');
  const message = sanitizeString(req.body.message || '');
  if (subject.length < 3 || subject.length > 120 || message.length < 5 || message.length > 2000) {
    return res.status(400).json({ success: false, message: 'Subject or message length is invalid.' });
  }
  const recipients = readJsonArray(USERS_FILE).filter(user => user.role === 'student' && user.email);
  let sent = 0;
  for (const user of recipients) {
    try { await sendBroadcastEmail(user, subject, message); sent += 1; }
    catch (error) { console.error('Broadcast email could not be sent:', error.message); }
  }
  res.json({ success: true, recipients: recipients.length, sent });
});

router.patch('/claims/:claimId', requireRole('admin'), async (req, res) => {
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Claim status must be approved or rejected.' });
  }

  const pickupInstructions = sanitizeString(req.body.pickupInstructions || '');
  const rejectionReason = sanitizeString(req.body.rejectionReason || '');
  const handoverSignature = sanitizeString(req.body.handoverSignature || '');
  if (pickupInstructions.length > 500) {
    return res.status(400).json({ success: false, message: 'Pickup instructions must be 500 characters or fewer.' });
  }
  if (status === 'rejected' && (rejectionReason.length < 5 || rejectionReason.length > 500)) {
    return res.status(400).json({ success: false, message: 'A rejection reason between 5 and 500 characters is required.' });
  }

  const claims = getClaims();
  const claim = claims.find(entry => entry.id === req.params.claimId);
  if (!claim) return res.status(404).json({ success: false, message: 'Claim request not found.' });
  if (claim.status !== 'pending') {
    return res.status(409).json({ success: false, message: 'This claim request has already been reviewed.' });
  }

  const items = getItems();
  const item = items.find(entry => String(entry.id) === String(claim.itemId));
  if (!item || item.claimed) {
    return res.status(409).json({ success: false, message: 'The item is no longer available.' });
  }

  claim.status = status;
  claim.reviewedAt = new Date().toISOString();
  claim.reviewedBy = req.session.user.id;
  claim.pickupInstructions = status === 'approved' ? pickupInstructions : '';
  claim.rejectionReason = status === 'rejected' ? rejectionReason : '';
  claim.notification = {
    id: `claim-notif-${crypto.randomUUID()}`,
    timestamp: claim.reviewedAt,
    read: false,
    message: status === 'approved'
      ? `Your claim for ${item.title} was approved.${pickupInstructions ? ` Pickup instructions: ${pickupInstructions}` : ''}`
      : `Your claim for ${item.title} was not approved. Reason: ${rejectionReason}`
  };
  claim.handover = status === 'approved' ? {
    acknowledged: true,
    acknowledgedAt: claim.reviewedAt,
    acknowledgedBy: req.session.user.id,
    acknowledgedByName: req.session.user.fullName,
    signature: handoverSignature || req.session.user.fullName || 'Admin approval'
  } : null;
  if (status === 'approved') {
    item.claimed = true;
    item.status = 'claimed';
    item.claimedAt = claim.reviewedAt;
    item.claimantProof = claim.proof;
    claims.forEach(other => {
      if (other.itemId === claim.itemId && other.id !== claim.id && other.status === 'pending') {
        other.status = 'rejected';
        other.reviewedAt = claim.reviewedAt;
        other.reviewedBy = req.session.user.id;
        other.rejectionReason = 'The item was approved for another claimant.';
        other.notification = {
          id: `claim-notif-${crypto.randomUUID()}`,
          timestamp: claim.reviewedAt,
          read: false,
          message: `Your claim for ${item.title} was not approved because the item was awarded to another claimant.`
        };
      }
    });
  } else {
    item.claimed = false;
    item.status = 'active';
    item.claimedAt = null;
  }
  addItemActivity(item, req, status === 'approved' ? 'Claim approved' : 'Claim rejected', status === 'approved' ? pickupInstructions : rejectionReason);
  saveItems(items);
  saveClaims(claims);

  if (claim.claimantEmail) {
    try {
      await sendClaimStatusEmail({ fullName: claim.claimantName, email: claim.claimantEmail }, item, claim, status);
    } catch (error) {
      console.error('Claim status email could not be sent:', error.message);
    }
  }

  const users = readJsonArray(USERS_FILE).filter(user =>
    user.email &&
    String(user.id) !== String(claim.claimantId) &&
    (user.role === 'admin' || String(user.id) === String(item.reportedBy))
  );
  for (const recipient of users) {
    try {
      await sendClaimRequestEmail(recipient, item, claim, status);
    } catch (error) {
      console.error('Claim status notification email could not be sent:', error.message);
    }
  }

  res.json({ success: true, message: `Claim request ${status}.`, claim });
});

// PATCH /api/items/claims/:claimId/handover - Record the physical handover acknowledgment.
router.patch('/claims/:claimId/handover', requireRole('admin'), (req, res) => {
  const claims = getClaims();
  const claim = claims.find(entry => entry.id === req.params.claimId);
  if (!claim || claim.status !== 'approved') return res.status(404).json({ success: false, message: 'Approved claim not found.' });
  const signature = sanitizeString(req.body.signature || '');
  if (signature.length < 2 || signature.length > 120) return res.status(400).json({ success: false, message: 'A handover acknowledgment is required.' });
  claim.handover = { acknowledged: true, acknowledgedAt: new Date().toISOString(), acknowledgedBy: req.session.user.id, acknowledgedByName: req.session.user.fullName, signature };
  saveClaims(claims);
  res.json({ success: true, handover: claim.handover });
});

// GET /api/items - Retrieve items with filters
router.get('/', (req, res) => {
  let items = getItems();
  const { type, location, search, category, status } = req.query;

  // Registered belongings isolation: only owner can see their registered belongings
  if (type === 'registered') {
    if (!req.session?.user) {
      return res.status(401).json({ success: false, message: 'Authentication required to view registered belongings.' });
    }
    items = items.filter(i => i.type === 'registered' && (i.reportedBy === req.session.user.id || req.session.user.role === 'admin'));
  } else {
    // Public feed strictly excludes private preventive belongings
    items = items.filter(i => i.type !== 'registered' && (req.session?.user?.role === 'admin' || i.status !== 'archived'));
  }

  // Type filter: lost | found
  if (type && ['lost', 'found'].includes(type)) {
    items = items.filter(i => i.type === type && !isItemClaimed(i));
  }

  // Status filter: claimed | active | archived
  if (status === 'claimed') {
    items = items.filter(isItemClaimed);
  } else if (status === 'archived') {
    items = items.filter(i => i.status === 'archived');
  } else if (status === 'active') {
    items = items.filter(i => !isItemClaimed(i));
  }

  // Category filter
  if (category) {
    items = items.filter(i => (i.category || '').toLowerCase() === category.toLowerCase());
  }

  // Location filter
  if (location) {
    const locFilter = location.toLowerCase();
    items = items.filter(i => (i.location || '').toLowerCase().includes(locFilter));
  }

  // Search keyword filter
  if (search) {
    const q = search.toLowerCase().trim();
    items = items.filter(i =>
      (i.title || '').toLowerCase().includes(q) ||
      (i.desc || i.description || '').toLowerCase().includes(q) ||
      (i.location || '').toLowerCase().includes(q) ||
      (i.category || '').toLowerCase().includes(q) ||
      (i.refCode && i.refCode.toLowerCase().includes(q))
    );
  }

  // Attach match previews for active items
  const allItems = getItems();
  const enhancedItems = items.map(item => {
    const match = findMatch(item, allItems);
    const user = req.session?.user;
    const canViewPrivateFields = user && (user.role === 'admin' || item.reportedBy === user.id);
    const canRequestClaim = Boolean(user && item.type === 'found' && !item.claimed
      && match?.type === 'lost' && String(match.reportedBy) === String(user.id));
    return canViewPrivateFields
      ? { ...item, canResolve: true, canRequestClaim, potentialMatch: match ? { id: match.id, title: match.title, location: match.location, type: match.type } : null }
      : publicItemView(item, match, Boolean(user && (user.role === 'admin' || String(item.reportedBy) === String(user.id))), canRequestClaim);
  });

  res.json({
    success: true,
    count: enhancedItems.length,
    items: enhancedItems
  });
});

// GET /api/items/qr-lookup/:refCode - Public lookup for finder scanning QR (privacy-safe, NO phone/email returned)
router.get('/qr-lookup/:refCode', (req, res) => {
  const items = getItems();
  const searchRef = req.params.refCode.toUpperCase().trim();
  const item = items.find(i => i.refCode && i.refCode.toUpperCase().trim() === searchRef);

  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found for this QR code.' });
  }

  // Strictly sanitized public payload — NEVER return owner phone, email, or social media!
  res.json({
    success: true,
    item: {
      refCode: item.refCode,
      title: item.title,
      category: item.category,
      type: item.type,
      location: item.location,
      instructions: item.instructions || 'If found, please send a message or return to CSPC SASO / Campus Security Desk.',
      isRegisteredBelonging: item.type === 'registered'
    }
  });
});

// POST /api/items/anonymous-notify - Public finder messaging (delivers alert straight to owner's account)
router.post('/anonymous-notify', async (req, res) => {
  try {
    const { refCode, message, locationFound, finderContact } = req.body;
    if (!refCode || !message) {
      return res.status(400).json({ success: false, message: 'Reference code and message are required.' });
    }
    if (String(message).length > 1000 || String(locationFound || '').length > 150 || String(finderContact || '').length > 150) {
      return res.status(400).json({ success: false, message: 'Finder message fields exceed the allowed length.' });
    }

    const items = getItems();
    const searchRef = refCode.toUpperCase().trim();
    const itemIndex = items.findIndex(i => i.refCode && i.refCode.toUpperCase().trim() === searchRef);

    if (itemIndex === -1) {
      return res.status(404).json({ success: false, message: 'Item not found with this reference code.' });
    }

    const item = items[itemIndex];
    if (item.type !== 'registered') {
      return res.status(404).json({ success: false, message: 'Registered belonging not found.' });
    }
    if (!item.notifications) item.notifications = [];

    const newNotification = {
      id: 'notif-' + Date.now(),
      refCode: item.refCode,
      itemTitle: item.title,
      message: sanitizeString(message),
      locationFound: sanitizeString(locationFound || 'Campus area'),
      finderContact: sanitizeString(finderContact || 'Anonymous Student / Finder'),
      timestamp: new Date().toISOString(),
      read: false
    };

    item.notifications.unshift(newNotification);
    item.notifications = item.notifications.slice(0, 100);
    saveItems(items);

    let emailSent = false;
    try {
      const owner = item.ownerEmail
        ? { email: item.ownerEmail, fullName: item.ownerName }
        : readJsonArray(USERS_FILE).find(user => String(user.id) === String(item.reportedBy));
      if (!owner?.email) throw new Error('Registered item has no owner email address.');
      await sendFinderNotificationEmail(owner, item, newNotification);
      emailSent = true;
    } catch (error) {
      console.error('Finder alert email could not be sent:', error.message);
    }

    res.json({
      success: true,
      message: emailSent
        ? 'Finder alert saved to the owner\'s inbox and sent by email.'
        : 'Finder alert saved to the owner\'s inbox, but email delivery is unavailable.',
      emailSent,
      itemTitle: item.title,
      notification: newNotification
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to deliver notification.' });
  }
});

// GET /api/items/my-notifications - Retrieve notification inbox for logged-in user's registered items
router.get('/my-notifications', requireAuth, (req, res) => {
  const items = getItems();
  const userId = req.session.user.id;
  const userItems = items.filter(i => String(i.reportedBy) === String(userId));
  const notifications = [];

  userItems.forEach(i => {
    if (i.notifications && Array.isArray(i.notifications)) {
      i.notifications.forEach(n => {
        notifications.push({
          ...n,
          itemId: i.id,
          itemTitle: i.title,
          refCode: i.refCode
        });
      });
    }
  });

  getClaims().filter(claim => claim.claimantId === userId && claim.notification).forEach(claim => {
    notifications.push({
      ...claim.notification,
      notificationType: 'claim',
      itemTitle: claim.itemTitle,
      refCode: claim.itemRefCode
    });
  });

  notifications.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  res.json({
    success: true,
    notifications,
    unreadCount: notifications.filter(n => !n.read).length
  });
});

// GET /api/items/match-reference-token - Create a short-lived verification link.
router.get('/match-reference-token', requireAuth, (req, res) => {
  const items = getItems();
  const first = items.find(item => String(item.id) === String(req.query.lostId) || String(item.id) === String(req.query.foundId));
  const second = items.find(item =>
    String(item.id) !== String(first?.id) &&
    (String(item.id) === String(req.query.lostId) || String(item.id) === String(req.query.foundId))
  );
  const lost = [first, second].find(item => item?.type === 'lost');
  const found = [first, second].find(item => item?.type === 'found');
  if (!lost || !found) {
    return res.status(404).json({ success: false, message: 'The matched lost and found reports could not be found.' });
  }
  const isAdmin = req.session.user.role === 'admin';
  if (!isAdmin && !findMatches(lost, items).some(match => String(match.id) === String(found.id))) {
    return res.status(403).json({ success: false, message: 'This report pair is not an available match reference.' });
  }

  const issuedAt = Date.now();
  const expiresAt = issuedAt + MATCH_REFERENCE_TTL_MS;
  const token = createMatchReferenceToken(lost.id, found.id, issuedAt);
  const referenceId = `MR-${issuedAt.toString(36).toUpperCase()}`;
  const status = getMatchReferenceStatus(found, getClaims());
  const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
  const url = `${baseUrl.replace(/\/$/, '')}/match-reference?token=${encodeURIComponent(token)}`;
  if (!isAdmin) {
    return res.json({
      success: true,
      view: 'status-only',
      token,
      url,
      referenceId,
      foundItemId: found.id,
      canRequestClaim: String(lost.reportedBy) === String(req.session.user.id) && !found.claimed,
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      status,
      lost: { id: lost.id, title: lost.title, refCode: lost.refCode },
      found: { id: found.id, title: found.title, refCode: found.refCode }
    });
  }
  res.json({
    success: true,
    token,
    url,
    referenceId,
    issuedAt: new Date(issuedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    status,
    lost: { id: lost.id, title: lost.title, refCode: lost.refCode },
    found: { id: found.id, title: found.title, refCode: found.refCode }
  });
});

// GET /api/items/match-reference/:token - Resolve a QR link with role-appropriate detail.
router.get('/match-reference/:token', (req, res) => {
  const reference = parseMatchReferenceToken(req.params.token);
  if (!reference || reference.expiresAt <= Date.now()) {
    return res.status(410).json({ success: false, message: 'This match reference has expired. Generate a new QR code.' });
  }

  const items = getItems();
  const lost = items.find(item => String(item.id) === reference.lostId && item.type === 'lost');
  const found = items.find(item => String(item.id) === reference.foundId && item.type === 'found');
  if (!lost || !found) return res.status(404).json({ success: false, message: 'Match reports are no longer available.' });

  const claims = getClaims();
  const status = getMatchReferenceStatus(found, claims);
  const referenceId = `MR-${reference.issuedAt.toString(36).toUpperCase()}`;
  if (!Array.isArray(found.matchScanLog)) found.matchScanLog = [];
  found.matchScanLog.unshift({
    scannedAt: new Date().toISOString(),
    scannerId: req.session?.user?.id || 'anonymous',
    scannerRole: req.session?.user?.role || 'anonymous'
  });
  found.matchScanLog = found.matchScanLog.slice(0, 100);
  saveItems(items);
  if (req.session?.user?.role !== 'admin') {
    return res.json({
      success: true,
      view: 'status-only',
      foundItemId: found.id,
      issuedAt: new Date(reference.issuedAt).toISOString(),
      expiresAt: new Date(reference.expiresAt).toISOString(),
      referenceId,
      status,
      lost: { id: lost.id, title: lost.title, refCode: lost.refCode },
      found: { id: found.id, title: found.title, refCode: found.refCode }
    });
  }

  res.json({
    success: true,
    view: 'admin',
    issuedAt: new Date(reference.issuedAt).toISOString(),
    expiresAt: new Date(reference.expiresAt).toISOString(),
    referenceId,
    scanCount: found.matchScanLog.length,
    lastScannedAt: found.matchScanLog[0].scannedAt,
    status,
    lost: publicItemView(lost),
    found: publicItemView(found),
    pendingClaims: claims.filter(claim => String(claim.itemId) === String(found.id) && claim.status === 'pending').length
  });
});

// GET /api/items/:id/photo - Serve an uploaded item photo through the API origin.
// This avoids browser/proxy differences when loading the raw /uploads path.
router.get('/:id/photo', async (req, res) => {
  const item = getItems().find(entry => String(entry.id) === String(req.params.id));
  if (!item || typeof item.photo !== 'string' || !item.photo) {
    return res.sendStatus(404);
  }

  const user = req.session?.user;
  const canViewPrivatePhoto = user && (user.role === 'admin' || item.reportedBy === user.id);
  if (item.type === 'registered' && !canViewPrivatePhoto) {
    return res.sendStatus(404);
  }

  const filename = path.basename(item.photo);
  if (!filename || filename === '.' || filename === '..') return res.sendStatus(404);

  if (supabaseStorage.objectKey(item.photo)) {
    try {
      const image = await supabaseStorage.downloadImage(item.photo);
      if (!image) return res.sendStatus(404);
      res.set('Content-Type', image.headers.get('content-type') || 'application/octet-stream');
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(Buffer.from(await image.arrayBuffer()));
    } catch (error) {
      console.error('Could not read item photo from Supabase Storage:', error.message);
      return res.sendStatus(502);
    }
  }

  res.sendFile(path.join(UPLOADS_DIR, filename), {
    headers: {
      'Cache-Control': 'public, max-age=86400'
    }
  }, error => {
    if (error && !res.headersSent) res.sendStatus(error.code === 'ENOENT' ? 404 : 500);
  });
});

// PATCH /api/items/notifications/:notifId/read - Mark notification as read
router.patch('/notifications/:notifId/read', requireAuth, (req, res) => {
  const items = getItems();
  const userId = req.session.user.id;
  const notifId = req.params.notifId;
  let found = false;

  items.forEach(i => {
    if (i.reportedBy === userId && i.notifications) {
      const targetNotif = i.notifications.find(n => n.id === notifId);
      if (targetNotif) {
        targetNotif.read = true;
        found = true;
      }
    }
  });

  const claims = getClaims();
  claims.forEach(claim => {
    if (claim.claimantId === userId && claim.notification?.id === notifId) {
      claim.notification.read = true;
      found = true;
    }
  });

  if (found) {
    saveItems(items);
    saveClaims(claims);
    return res.json({ success: true, message: 'Notification marked as read.' });
  }

  res.status(404).json({ success: false, message: 'Notification not found.' });
});

// GET /api/items/:id - Single item
router.get('/:id', (req, res) => {
  const items = getItems();
  const item = items.find(i => String(i.id) === String(req.params.id));
  const user = req.session?.user;
  const canViewPrivateFields = user && (user.role === 'admin' || item?.reportedBy === user.id);
  if (!item || (item.type === 'registered' && !canViewPrivateFields)) {
    return res.status(404).json({ success: false, message: 'Item not found.' });
  }

  const match = findMatch(item, items);
  if (item.type !== 'registered' && !canViewPrivateFields) {
    return res.json({ success: true, item: publicItemView(item, match) });
  }

  res.json({
    success: true,
    item: {
      ...item,
      potentialMatch: match ? { id: match.id, title: match.title, location: match.location, type: match.type } : null
    }
  });
});

router.post('/:id/claim-requests', requireAuth, async (req, res) => {
  const proof = sanitizeString(req.body.proof || '');
  const courseYear = sanitizeString(req.body.courseYear || req.session.user.courseYear || req.session.user.yearLevel || '');
  const contactNumber = sanitizeString(req.body.contactNumber || req.session.user.phone || req.session.user.contactNumber || '');
  if (proof.length < 5 || proof.length > 500) {
    return res.status(400).json({ success: false, message: 'Ownership details must be between 5 and 500 characters.' });
  }
  if (courseYear.length > 100 || contactNumber.length > 50) {
    return res.status(400).json({ success: false, message: 'Claimant contact details exceed the allowed length.' });
  }

  const items = getItems();
  const item = items.find(entry => String(entry.id) === String(req.params.id));
  if (!item || item.type !== 'found' || item.claimed) {
    return res.status(404).json({ success: false, message: 'Found item is no longer available for a claim.' });
  }

  const lostItem = items.find(entry =>
    String(entry.id) === String(req.body.lostId) &&
    entry.type === 'lost'
  );
  const isLostReporter = lostItem && String(lostItem.reportedBy) === String(req.session.user.id);
  const isPotentialMatch = lostItem && findMatches(lostItem, items).some(match => String(match.id) === String(item.id));
  if (!isLostReporter || !isPotentialMatch) {
    return res.status(403).json({ success: false, message: 'Only the original reporter of the matching lost item can submit this claim request.' });
  }

  const claims = getClaims();
  const duplicate = claims.some(claim =>
    String(claim.itemId) === String(item.id) &&
    claim.claimantId === req.session.user.id &&
    claim.status === 'pending'
  );
  if (duplicate) {
    return res.status(409).json({ success: false, message: 'You already have a pending claim for this item.' });
  }

  const claim = {
    id: `claim-${crypto.randomUUID()}`,
    itemId: item.id,
    itemTitle: item.title,
    itemRefCode: item.refCode,
    lostItemId: lostItem.id,
    lostItemTitle: lostItem.title,
    lostItemRefCode: lostItem.refCode,
    claimantId: req.session.user.id,
    claimantName: req.session.user.fullName,
    claimantEmail: req.session.user.email,
    claimantContact: contactNumber,
    claimantStudentId: req.session.user.studentId || '',
    claimantCourseYear: courseYear,
    claimantDepartment: req.session.user.department || '',
    proof,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  claims.unshift(claim);
  saveClaims(claims);

  const users = readJsonArray(USERS_FILE);
  const recipients = users.filter(user =>
    user.email && (
      user.role === 'admin' ||
      String(user.id) === String(item.reportedBy) ||
      String(user.id) === String(req.session.user.id)
    )
  );
  for (const recipient of recipients) {
    try {
      await sendClaimRequestEmail(recipient, item, claim, 'submitted');
    } catch (error) {
      console.error('Claim request email could not be sent:', error.message);
    }
  }

  res.status(201).json({ success: true, message: 'Claim request submitted for moderator review.', claim: { id: claim.id, status: claim.status } });
});

// POST /api/items - Create item report
router.post('/', upload.single('photo'), postgresStore.requestMiddleware(), validateItemReport, async (req, res) => {
  try {
    const items = getItems();
    const { title, category, type, location, locationDetails, contact, desc, verification } = req.body;
    if (req.file && !isValidImage(req.file)) {
      return res.status(400).json({ success: false, message: 'The uploaded file is not a valid supported image.' });
    }

    const submissionKey = req.get('Idempotency-Key')?.trim();
    if (submissionKey && !/^[A-Za-z0-9_-]{16,128}$/.test(submissionKey)) {
      return res.status(400).json({ success: false, message: 'Invalid report submission key.' });
    }

    const reporterId = req.session?.user ? req.session.user.id : 'guest';
    const submissionFingerprint = crypto.createHash('sha256').update(JSON.stringify({
      title,
      category,
      type,
      location,
      locationDetails,
      contact,
      desc,
      verification,
      photo: req.file ? crypto.createHash('sha256').update(req.file.buffer).digest('hex') : ''
    })).digest('hex');

    if (submissionKey) {
      const previousSubmission = items.find(item => item.submissionKey === submissionKey);
      if (previousSubmission) {
        if (String(previousSubmission.reportedBy) !== String(reporterId)) {
          return res.status(409).json({ success: false, message: 'This submission key is already in use.' });
        }
        if (previousSubmission.submissionFingerprint !== submissionFingerprint) {
          return res.status(409).json({ success: false, message: 'This submission key was already used for a different report.' });
        }

        const responseItem = { ...previousSubmission };
        delete responseItem.submissionKey;
        delete responseItem.submissionFingerprint;
        return res.json({
          success: true,
          duplicate: true,
          message: `This report was already received with Reference Code: ${previousSubmission.refCode}`,
          item: responseItem,
          potentialMatch: null
        });
      }
    }

    const nextSeq = items.length + 1;
    const refCode = `CSPC-LF-2026-${String(nextSeq).padStart(3, '0')}`;
    const photo = req.file ? await saveUploadedImage(req.file) : '';

    const newItem = {
      id: Date.now(),
      refCode,
      title,
      category,
      type,
      location,
      locationDetails: locationDetails || '',
      contact,
      desc,
      verification: verification || '',
      photo: photo || '',
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      status: 'active',
      claimed: false,
      reportedBy: reporterId,
      ...(submissionKey ? { submissionKey, submissionFingerprint } : {}),
      createdAt: new Date().toISOString()
    };

    items.unshift(newItem);
    const matches = findMatches(newItem, items);
    const match = matches[0] || null;
    const matchedAt = new Date().toISOString();
    const emailNotifications = [];
    const users = readJsonArray(USERS_FILE);

    for (const matchedItem of matches) {
      const lostItem = newItem.type === 'lost' ? newItem : matchedItem;
      const foundItem = newItem.type === 'found' ? newItem : matchedItem;
      linkMatchedItems(lostItem, foundItem, matchedAt);

      const student = getStudentReporter(lostItem, users);
      if (student) {
        const notification = createMatchNotification(lostItem, foundItem);
        if (notification) {
          emailNotifications.push({ student, lostItem, foundItem });
        }
      }
    }

    saveItems(items);

    for (const { student, lostItem, foundItem } of emailNotifications) {
      try {
        await sendPossibleMatchEmail(student, lostItem, foundItem);
      } catch (error) {
        console.error('Possible-match notification email could not be sent:', error.message);
      }
    }

    const responseItem = { ...newItem };
    delete responseItem.submissionKey;
    delete responseItem.submissionFingerprint;
    res.status(201).json({
      success: true,
      message: `Item successfully reported with Reference Code: ${refCode}`,
      item: responseItem,
      potentialMatch: match ? { id: match.id, title: match.title, location: match.location, type: match.type } : null
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to record item report.' });
  }
});

// GET /api/items/:id/activity - Read the audit trail for an item.
router.get('/:id/activity', requireRole('admin'), (req, res) => {
  const item = getItems().find(entry => String(entry.id) === String(req.params.id));
  if (!item) return res.status(404).json({ success: false, message: 'Item not found.' });
  res.json({ success: true, activity: Array.isArray(item.activityLog) ? item.activityLog : [] });
});

// POST /api/items/:id/activity - Add an admin note to an item audit trail.
router.post('/:id/activity', requireRole('admin'), (req, res) => {
  const items = getItems();
  const item = items.find(entry => String(entry.id) === String(req.params.id));
  if (!item) return res.status(404).json({ success: false, message: 'Item not found.' });
  const notes = sanitizeString(req.body.notes || '');
  if (notes.length < 1 || notes.length > 500) {
    return res.status(400).json({ success: false, message: 'A note between 1 and 500 characters is required.' });
  }
  addItemActivity(item, req, 'Admin note', notes);
  saveItems(items);
  res.status(201).json({ success: true, activity: item.activityLog[0] });
});

// PATCH /api/items/bulk - Apply a validated action to selected items.
router.patch('/bulk', requireRole('admin'), (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String).filter(Boolean) : [];
  const action = req.body.action;
  if (!ids.length || ids.length > 100) return res.status(400).json({ success: false, message: 'Select between 1 and 100 items.' });
  if (!['claim', 'delete', 'archive', 'status'].includes(action)) return res.status(400).json({ success: false, message: 'Unsupported bulk action.' });
  const status = action === 'status' ? sanitizeString(req.body.status || '') : action === 'archive' ? 'archived' : '';
  if (action === 'status' && !['active', 'claimed', 'archived'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid bulk status.' });

  let items = getItems();
  const selected = items.filter(item => ids.includes(String(item.id)));
  if (!selected.length) return res.status(404).json({ success: false, message: 'No selected items were found.' });
  if (action === 'claim' || action === 'archive' || action === 'status') {
    selected.forEach(item => {
      if (action === 'claim' && !isItemClaimed(item)) {
        item.claimed = true;
        item.status = 'claimed';
        item.claimedAt = new Date().toISOString();
        item.claimantProof = 'Bulk status update by moderator.';
        addItemActivity(item, req, 'Marked as claimed', 'Bulk admin action.');
      } else if (status === 'archived') {
        item.status = 'archived';
        item.archivedAt = new Date().toISOString();
        addItemActivity(item, req, 'Archived', 'Bulk admin action.');
      } else if (status === 'active') {
        item.status = 'active';
        item.claimed = false;
        item.claimedAt = null;
        addItemActivity(item, req, 'Restored to active', 'Bulk admin action.');
      }
    });
    saveItems(items);
  } else {
    selected.forEach(item => addItemActivity(item, req, 'Deleted', 'Bulk admin action.'));
    items = items.filter(item => !ids.includes(String(item.id)));
    saveItems(items);
    saveClaims(getClaims().filter(claim => !ids.includes(String(claim.itemId))));
  }
  res.json({ success: true, affected: selected.length, action });
});

// PATCH /api/items/:id/status - Update active, claimed, or archived status.
router.patch('/:id/status', requireRole('admin'), (req, res) => {
  const status = sanitizeString(req.body.status || '');
  if (!['active', 'claimed', 'archived'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid item status.' });
  const items = getItems();
  const item = items.find(entry => String(entry.id) === String(req.params.id));
  if (!item) return res.status(404).json({ success: false, message: 'Item not found.' });
  item.status = status;
  item.claimed = status === 'claimed';
  if (status === 'archived') item.archivedAt = new Date().toISOString();
  if (status !== 'claimed') item.claimedAt = null;
  addItemActivity(item, req, `Status changed to ${status}`, 'Inline admin status update.');
  saveItems(items);
  res.json({ success: true, message: `Item status updated to ${status}.`, item });
});

// PATCH /api/items/:id/claim - Resolve or restore item for admins and the original reporter.
router.patch('/:id/claim', requireAuth, async (req, res) => {
  const items = getItems();
  const itemIndex = items.findIndex(i => String(i.id) === String(req.params.id));
  if (itemIndex === -1) {
    return res.status(404).json({ success: false, message: 'Item not found.' });
  }

  const item = items[itemIndex];
  const canResolve = req.session.user.role === 'admin'
    || String(item.reportedBy) === String(req.session.user.id);
  if (!canResolve) {
    return res.status(403).json({ success: false, message: 'Only the original reporter or an administrator can resolve this item.' });
  }

  // If already claimed, allow unclaiming/restoring
  if (item.claimed) {
    item.claimed = false;
    item.status = 'active';
    item.claimedAt = null;
    item.claimantProof = null;
    addItemActivity(item, req, 'Restored to active', 'Item status restored by moderator.');
    saveItems(items);
    return res.json({ success: true, message: 'Item restored to active status.', item });
  }

  // Claiming item
  const { proof } = req.body;
  item.claimed = true;
  item.status = 'claimed';
  item.claimedAt = new Date().toISOString();
  item.claimantProof = sanitizeString(proof || 'Verified by SAO Officer / Finder');
  addItemActivity(item, req, 'Marked as claimed', item.claimantProof);

  saveItems(items);
  if (item.reporterEmail) {
    try {
      await sendClaimStatusEmail({ fullName: item.reporterName, email: item.reporterEmail }, item, { claimantName: item.reporterName, claimantEmail: item.reporterEmail }, 'approved');
    } catch (error) {
      console.error('Claim notification email could not be sent:', error.message);
    }
  }
  res.json({
    success: true,
    message: `Item ${item.refCode} marked as claimed.`,
    item
  });
});

// DELETE /api/items/:id - Remove item (Admin or original reporter)
router.delete('/:id', requireRole('admin'), async (req, res) => {
  let items = getItems();
  const item = items.find(i => String(i.id) === String(req.params.id));
  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found.' });
  }

  items = items.filter(i => String(i.id) !== String(req.params.id));
  saveItems(items);
  if (typeof item.photo === 'string' && item.photo.startsWith('/uploads/')) {
    fs.rmSync(path.join(UPLOADS_DIR, path.basename(item.photo)), { force: true });
  }
  if (supabaseStorage.objectKey(item.photo)) await supabaseStorage.deleteImage(item.photo);
  saveClaims(getClaims().filter(claim => String(claim.itemId) !== String(item.id)));

  res.json({ success: true, message: 'Item report deleted.' });
});

// POST /api/items/register-belonging - Register personal belonging (Auth required)
router.post('/register-belonging', requireAuth, (req, res) => {
  try {
    const items = getItems();
    const { title, category, location, identifiers, instructions } = req.body;

    if (!title || !category) {
      return res.status(400).json({ success: false, message: 'Title and category are required.' });
    }

    const nextSeq = items.length + 1;
    const refCode = `CSPC-REG-QR-${String(nextSeq).padStart(4, '0')}`;
    const user = req.session.user;

    const newBelonging = {
      id: Date.now(),
      refCode,
      title: sanitizeString(title),
      category: sanitizeString(category),
      type: 'registered', // Preventive personal belonging
      location: sanitizeString(location || 'Campus-wide'),
      locationDetails: sanitizeString(identifiers || ''),
      instructions: sanitizeString(instructions || 'If found, please notify owner via QR or leave with CSPC SASO / Campus Security.'),
      contact: `${user.fullName} (${user.studentId || user.email})`,
      desc: identifiers ? `Valuable belonging: ${sanitizeString(identifiers)}` : 'Valuable personal belonging registered in student vault.',
      verification: identifiers || 'Registered by verified CSPC account',
      photo: '',
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      status: 'registered',
      claimed: false,
      reportedBy: user.id,
      ownerName: user.fullName,
      ownerEmail: user.email,
      notifications: [],
      createdAt: new Date().toISOString()
    };

    items.unshift(newBelonging);
    saveItems(items);

    res.status(201).json({
      success: true,
      message: 'Belonging successfully registered in your private vault!',
      item: newBelonging
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to register belonging.' });
  }
});

module.exports = router;
