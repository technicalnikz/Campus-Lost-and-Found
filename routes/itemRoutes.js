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
const { sendPossibleMatchEmail } = require('../services/email');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
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

function saveUploadedImage(file) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const filename = `${crypto.randomUUID()}.${IMAGE_EXTENSIONS[file.mimetype]}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), file.buffer, { flag: 'wx' });
  return `/uploads/${filename}`;
}

function publicItemView(item, potentialMatch = null) {
  return {
    id: item.id,
    refCode: item.refCode,
    title: item.title,
    category: item.category,
    type: item.type,
    location: item.location,
    desc: item.desc || item.description || '',
    photo: item.photo || item.imageUrl || '',
    date: item.date,
    createdAt: item.createdAt,
    status: item.status,
    claimed: Boolean(item.claimed),
    claimedAt: item.claimedAt || null,
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

function findMatch(item, allItems) {
  if (isItemClaimed(item)) return null;
  const targetType = item.type === 'lost' ? 'found' : 'lost';

  let bestMatch = null;
  let bestScore = 0;
  let bestMeta = null;

  for (const other of allItems) {
    if (other.id === item.id || other.type !== targetType || isItemClaimed(other)) continue;

    const meta = scorePotentialMatch(item, other);
    if (meta.score > bestScore) {
      bestScore = meta.score;
      bestMatch = other;
      bestMeta = meta;
    }
  }

  const hasStrongCategory = !!(bestMeta && bestMeta.categoryMatch);
  const hasStrongNameSimilarity = !!(bestMeta && bestMeta.nameSimilarity >= 0.28);
  const hasStrongDescriptionSimilarity = !!(bestMeta && bestMeta.descSimilarity >= 0.22);
  const hasVerificationOverlap = !!(bestMeta && bestMeta.verificationScore > 0);

  if (!bestMatch || !bestMeta) return null;
  if (!hasStrongCategory) return null;
  if (!hasStrongNameSimilarity && !hasStrongDescriptionSimilarity && !hasVerificationOverlap) return null;
  if (bestScore < 0.58) return null;

  return bestMatch;
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

router.patch('/claims/:claimId', requireRole('admin'), (req, res) => {
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Claim status must be approved or rejected.' });
  }

  const pickupInstructions = sanitizeString(req.body.pickupInstructions || '');
  const rejectionReason = sanitizeString(req.body.rejectionReason || '');
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
  saveItems(items);
  saveClaims(claims);

  res.json({ success: true, message: `Claim request ${status}.`, claim });
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
    items = items.filter(i => i.type !== 'registered');
  }

  // Type filter: lost | found
  if (type && ['lost', 'found'].includes(type)) {
    items = items.filter(i => i.type === type && !isItemClaimed(i));
  }

  // Status filter: claimed | active
  if (status === 'claimed') {
    items = items.filter(isItemClaimed);
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
    return canViewPrivateFields
      ? { ...item, potentialMatch: match ? { id: match.id, title: match.title, location: match.location, type: match.type } : null }
      : publicItemView(item, match);
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
router.post('/anonymous-notify', (req, res) => {
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

    res.json({
      success: true,
      message: 'Anonymous alert sent straight to the owner\'s account notification inbox! 📲',
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
  const userItems = items.filter(i => i.reportedBy === userId);
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

router.post('/:id/claim-requests', requireAuth, (req, res) => {
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
  if (item.reportedBy === req.session.user.id) {
    return res.status(403).json({ success: false, message: 'You cannot submit a claim for your own report.' });
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

  res.status(201).json({ success: true, message: 'Claim request submitted for moderator review.', claim: { id: claim.id, status: claim.status } });
});

// POST /api/items - Create item report
router.post('/', upload.single('photo'), validateItemReport, async (req, res) => {
  try {
    const items = getItems();
    const nextSeq = items.length + 1;
    const refCode = `CSPC-LF-2026-${String(nextSeq).padStart(3, '0')}`;

    const { title, category, type, location, locationDetails, contact, desc, verification } = req.body;
    if (req.file && !isValidImage(req.file)) {
      return res.status(400).json({ success: false, message: 'The uploaded file is not a valid supported image.' });
    }
    const photo = req.file ? saveUploadedImage(req.file) : '';

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
      reportedBy: req.session?.user ? req.session.user.id : 'guest',
      createdAt: new Date().toISOString()
    };

    items.unshift(newItem);
    const match = findMatch(newItem, items);
    let matchNotification = null;
    let matchNotificationRecipient = null;
    if (match) {
      const lostItem = newItem.type === 'lost' ? newItem : match;
      const foundItem = newItem.type === 'found' ? newItem : match;
      const student = readJsonArray(USERS_FILE).find(user =>
        user.id === lostItem.reportedBy && user.role === 'student'
      );
      const notifications = Array.isArray(lostItem.notifications) ? lostItem.notifications : [];
      const alreadyNotified = notifications.some(notification =>
        notification.notificationType === 'match' &&
        String(notification.matchItemId) === String(foundItem.id)
      );

      if (student && !alreadyNotified) {
        matchNotificationRecipient = student;
        matchNotification = {
          id: `notif-${crypto.randomUUID()}`,
          notificationType: 'match',
          itemTitle: lostItem.title,
          refCode: lostItem.refCode,
          matchItemId: foundItem.id,
          matchItemTitle: foundItem.title,
          matchRefCode: foundItem.refCode,
          message: 'A found item may match your lost-item report. Sign in to review it.',
          timestamp: new Date().toISOString(),
          read: false
        };
        lostItem.notifications = [matchNotification, ...notifications].slice(0, 100);
      }
    }

    saveItems(items);

    if (matchNotification && matchNotificationRecipient) {
      try {
        await sendPossibleMatchEmail(
          matchNotificationRecipient,
          matchNotification.matchRefCode,
          matchNotification.matchItemId
        );
      } catch (error) {
        console.error('Possible-match notification email could not be sent:', error.message);
      }
    }

    res.status(201).json({
      success: true,
      message: `Item successfully reported with Reference Code: ${refCode}`,
      item: newItem,
      potentialMatch: match ? { id: match.id, title: match.title, location: match.location, type: match.type } : null
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to record item report.' });
  }
});

// PATCH /api/items/:id/claim - Claim or restore item
router.patch('/:id/claim', requireRole('admin'), (req, res) => {
  const items = getItems();
  const itemIndex = items.findIndex(i => String(i.id) === String(req.params.id));
  if (itemIndex === -1) {
    return res.status(404).json({ success: false, message: 'Item not found.' });
  }

  const item = items[itemIndex];

  // If already claimed, allow unclaiming/restoring
  if (item.claimed) {
    item.claimed = false;
    item.status = 'active';
    item.claimedAt = null;
    item.claimantProof = null;
    saveItems(items);
    return res.json({ success: true, message: 'Item restored to active status.', item });
  }

  // Claiming item
  const { proof } = req.body;
  item.claimed = true;
  item.status = 'claimed';
  item.claimedAt = new Date().toISOString();
  item.claimantProof = sanitizeString(proof || 'Verified by SAO Officer / Finder');

  saveItems(items);
  res.json({
    success: true,
    message: `Item ${item.refCode} marked as claimed.`,
    item
  });
});

// DELETE /api/items/:id - Remove item (Admin or original reporter)
router.delete('/:id', requireRole('admin'), (req, res) => {
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
