// routes/itemRoutes.js - Item Management, Smart Matching, and Claim Handlers
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { validateItemReport, sanitizeString } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');

const ITEMS_FILE = path.join(__dirname, '..', 'data', 'items.json');

function getItems() {
  try {
    const data = fs.readFileSync(ITEMS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

function saveItems(items) {
  fs.writeFileSync(ITEMS_FILE, JSON.stringify(items, null, 2), 'utf8');
}

// Helper: Smart Match & Reconciliation Detector
function findMatch(item, allItems) {
  if (item.claimed) return null;
  const targetType = item.type === 'lost' ? 'found' : 'lost';

  const stopWords = ['with', 'case', 'blue', 'black', 'item', 'lost', 'found', 'cspc', 'college'];
  const keywords = item.title.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.includes(w));

  return allItems.find(other => {
    if (other.id === item.id || other.type !== targetType || other.claimed) return false;

    const otherTitle = other.title.toLowerCase();
    const hasKeyword = keywords.some(k => otherTitle.includes(k));
    const sameCategory = other.category === item.category;
    const sameLocation = other.location.toLowerCase().includes(item.location.toLowerCase().split(' ')[0]);

    return hasKeyword || (sameCategory && sameLocation);
  });
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
    items = items.filter(i => i.type === type && !i.claimed);
  }

  // Status filter: claimed | active
  if (status === 'claimed') {
    items = items.filter(i => i.claimed);
  } else if (status === 'active') {
    items = items.filter(i => !i.claimed);
  }

  // Category filter
  if (category) {
    items = items.filter(i => i.category.toLowerCase() === category.toLowerCase());
  }

  // Location filter
  if (location) {
    const locFilter = location.toLowerCase();
    items = items.filter(i => i.location.toLowerCase().includes(locFilter));
  }

  // Search keyword filter
  if (search) {
    const q = search.toLowerCase().trim();
    items = items.filter(i =>
      i.title.toLowerCase().includes(q) ||
      i.desc.toLowerCase().includes(q) ||
      i.location.toLowerCase().includes(q) ||
      i.category.toLowerCase().includes(q) ||
      (i.refCode && i.refCode.toLowerCase().includes(q))
    );
  }

  // Attach match previews for active items
  const allItems = getItems();
  const enhancedItems = items.map(item => {
    const match = findMatch(item, allItems);
    return {
      ...item,
      potentialMatch: match ? { id: match.id, title: match.title, location: match.location, type: match.type } : null
    };
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
  const item = items.find(i =>
    (i.refCode && i.refCode.toUpperCase().trim() === searchRef) ||
    String(i.id) === searchRef
  );

  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found for this QR code.' });
  }

  // Strictly sanitized public payload — NEVER return owner phone, email, or social media!
  res.json({
    success: true,
    item: {
      id: item.id,
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

    const items = getItems();
    const searchRef = refCode.toUpperCase().trim();
    const itemIndex = items.findIndex(i =>
      (i.refCode && i.refCode.toUpperCase().trim() === searchRef) ||
      String(i.id) === searchRef
    );

    if (itemIndex === -1) {
      return res.status(404).json({ success: false, message: 'Item not found with this reference code.' });
    }

    const item = items[itemIndex];
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

  if (found) {
    saveItems(items);
    return res.json({ success: true, message: 'Notification marked as read.' });
  }

  res.status(404).json({ success: false, message: 'Notification not found.' });
});

// GET /api/items/:id - Single item
router.get('/:id', (req, res) => {
  const items = getItems();
  const item = items.find(i => String(i.id) === String(req.params.id));
  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found.' });
  }

  const match = findMatch(item, items);
  res.json({
    success: true,
    item: {
      ...item,
      potentialMatch: match ? { id: match.id, title: match.title, location: match.location, type: match.type } : null
    }
  });
});

// POST /api/items - Create item report
router.post('/', validateItemReport, (req, res) => {
  try {
    const items = getItems();
    const nextSeq = items.length + 1;
    const refCode = `CSPC-LF-2026-${String(nextSeq).padStart(3, '0')}`;

    const { title, category, type, location, locationDetails, contact, desc, verification, photo } = req.body;

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
    saveItems(items);

    const match = findMatch(newItem, items);

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
router.patch('/:id/claim', (req, res) => {
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
router.delete('/:id', (req, res) => {
  let items = getItems();
  const item = items.find(i => String(i.id) === String(req.params.id));
  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found.' });
  }

  // Check permission: if logged in as admin or as the reporter
  const user = req.session?.user;
  if (user && user.role !== 'admin' && item.reportedBy !== user.id) {
    return res.status(403).json({
      success: false,
      message: 'You do not have permission to delete this report.'
    });
  }

  items = items.filter(i => String(i.id) !== String(req.params.id));
  saveItems(items);

  res.json({ success: true, message: 'Item report deleted.' });
});

// POST /api/items/register-belonging - Register personal belonging (Auth required)
router.post('/register-belonging', requireAuth, (req, res) => {
  try {
    const items = getItems();
    const { title, category, location, identifiers, instructions, photo } = req.body;

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
      photo: photo || '',
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
