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

  res.json({
    success: true,
    message: 'Report permanently removed from records.'
  });
});

module.exports = router;
