// routes/itemRoutes.js - Item Management, Smart Matching, and Claim Handlers
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { validateItemReport, sanitizeString } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { isRateLimited, recordAttempt } = require('../middleware/rateLimit');
const { readJsonArray, writeJsonArray } = require('../services/jsonStore');
const {
  sendPossibleMatchEmail,
  sendClaimStatusEmail,
  sendClaimRequestEmail,
  sendFinderNotificationEmail,
  sendMatchFinderNotificationEmail,
  sendBroadcastEmail,
  sendMeetupRequestEmail,
} = require('../services/email');
const messenger = require('../services/messenger');
const postgresStore = require('../services/postgresStore');
const supabaseStorage = require('../services/supabaseStorage');
const reportAssistant = require('../services/reportAssistant');
const imageModeration = require('../services/imageModeration');
const matchScorer = require('../services/matchScorer');

function finderSubmissionFingerprint(target, message, locationFound, finderContact) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        target,
        message,
        locationFound,
        finderContact,
      })
    )
    .digest('hex');
}

function findFinderSubmission(items, submissionKey) {
  if (!submissionKey) return null;
  for (const item of items) {
    const notification = (Array.isArray(item.notifications) ? item.notifications : []).find(
      (entry) => entry.submissionKey === submissionKey
    );
    if (notification) return notification;
  }
  return null;
}

function publicFinderNotification(notification) {
  const { submissionKey, submissionFingerprint, conversation, ...result } = notification;
  if (conversation) {
    result.conversation = {
      status: conversation.status,
      expiresAt: conversation.expiresAt,
    };
  }
  return result;
}

const REGISTERED_CONVERSATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REGISTERED_CONVERSATION_MESSAGE_LIMIT = { max: 60, windowMs: 60 * 60 * 1000 };
const registeredConversationAttempts = new Map();

function finderConversationTokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function loadRegisteredConversation(req, res, role) {
  const items = getItems();
  const item = items.find(
    (entry) =>
      entry.type === 'registered' &&
      Array.isArray(entry.notifications) &&
      entry.notifications.some(
        (notification) => notification.id === req.params.conversationId && notification.conversation
      )
  );
  const notification = item?.notifications.find((entry) => entry.id === req.params.conversationId);
  const conversation = notification?.conversation;
  if (!item || !notification || !conversation) {
    res.status(404).json({ success: false, message: 'Finder conversation not found.' });
    return null;
  }
  if (Date.parse(conversation.expiresAt) <= Date.now()) {
    res.status(410).json({ success: false, message: 'This finder conversation has expired.' });
    return null;
  }

  if (role === 'owner') {
    if (String(item.reportedBy) !== String(req.session.user.id)) {
      res.status(404).json({ success: false, message: 'Finder conversation not found.' });
      return null;
    }
  } else {
    const token = /^Bearer ([a-f0-9]{64})$/i.exec(req.get('Authorization') || '')?.[1];
    if (!token) {
      res.status(401).json({ success: false, message: 'A valid conversation link is required.' });
      return null;
    }
    const providedHash = Buffer.from(finderConversationTokenHash(token), 'hex');
    const savedHash = Buffer.from(String(conversation.tokenHash || ''), 'hex');
    if (savedHash.length !== providedHash.length || !crypto.timingSafeEqual(providedHash, savedHash)) {
      res.status(404).json({ success: false, message: 'Finder conversation not found.' });
      return null;
    }
  }

  return { items, item, notification, conversation, role };
}

function registeredConversationView(context) {
  const { item, notification, conversation, role } = context;
  const otherRole = role === 'owner' ? 'finder' : 'owner';
  const meetup = conversation.meetup || {};
  const myRequest = meetup[role] || {};
  const theirRequest = meetup[otherRole] || {};
  const otherName =
    role === 'owner'
      ? notification.finderContact && notification.finderContact !== 'Anonymous Student / Finder'
        ? notification.finderContact
        : 'Anonymous finder'
      : 'Item owner';

  return {
    success: true,
    claim: { id: notification.id, status: conversation.status === 'returned' ? 'returned' : 'pending' },
    conversation: { id: notification.id, status: conversation.status, expiresAt: conversation.expiresAt },
    item: { id: item.id, title: item.title },
    otherName,
    role,
    messages: (conversation.messages || []).map((message) => ({
      id: message.id,
      text: message.text,
      mine: message.sender === role,
      createdAt: message.createdAt,
    })),
    confirmedByMe: (conversation.confirmations || []).includes(role),
    confirmedByOther: (conversation.confirmations || []).includes(otherRole),
    meetupNotification: {
      claimId: `registered:${notification.id}`,
      itemTitle: item.title,
      role,
      otherName,
      timestamp: notification.timestamp,
      myLocation: {
        status: theirRequest.status,
        location: theirRequest.location,
        expiresAt: theirRequest.location?.expiresAt,
      },
      theirLocation: {
        status: myRequest.status,
        location: myRequest.location,
        expiresAt: myRequest.location?.expiresAt,
        askAgainAt:
          myRequest.status === 'declined'
            ? new Date(Date.parse(myRequest.respondedAt) + MEETUP_ASK_AGAIN_MS).toISOString()
            : null,
      },
    },
  };
}

function pruneRegisteredConversationMeetup(conversation, now = Date.now()) {
  if (!conversation.meetup) return false;
  let changed = false;
  Object.values(conversation.meetup).forEach((request) => {
    if (request.location && Date.parse(request.location.expiresAt) <= now) {
      delete request.location;
      request.status = 'expired';
      changed = true;
    }
    if (request.status === 'pending' && now - Date.parse(request.createdAt) > MEETUP_REQUEST_TTL_MS) {
      request.status = 'expired';
      changed = true;
    }
  });
  return changed;
}

function registeredConversationHandler(role, handler) {
  return async (req, res, next) => {
    try {
      const context = loadRegisteredConversation(req, res, role);
      if (!context) return;
      await handler(context, req, res);
    } catch (error) {
      next(error);
    }
  };
}

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
  'image/webp': 'webp',
};
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(req, file, callback) {
    if (!IMAGE_EXTENSIONS[file.mimetype]) {
      return callback(Object.assign(new Error('Upload a JPEG, PNG, GIF, or WebP image.'), { status: 400 }));
    }
    callback(null, true);
  },
});

function isValidImage(file) {
  const bytes = file.buffer;
  if (file.mimetype === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (file.mimetype === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (file.mimetype === 'image/gif') return ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6));
  if (file.mimetype === 'image/webp')
    return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
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

// Limits on what can be posted without an admin in the loop. Guests are counted per
// network address (a whole campus Wi-Fi can share one, so that limit is generous);
// signed-in students per account. Finder alerts are also capped per item, because each
// one emails the owner.
const HOUR_MS = 60 * 60 * 1000;
const GUEST_REPORT_LIMIT = { max: 20, windowMs: HOUR_MS };
const ACCOUNT_REPORT_LIMIT = { max: 30, windowMs: HOUR_MS };
const FINDER_ALERT_SENDER_LIMIT = { max: 30, windowMs: HOUR_MS };
const FINDER_ALERT_ITEM_LIMIT = { max: 6, windowMs: HOUR_MS };
// The assistant is capped more tightly than reports: each call can reach a paid AI API, so a
// loose limit would let one network run up a bill. Typing a report takes a handful of turns.
const ASSISTANT_GUEST_LIMIT = { max: 40, windowMs: HOUR_MS };
const ASSISTANT_ACCOUNT_LIMIT = { max: 60, windowMs: HOUR_MS };
const reportAttempts = new Map();
const finderAlertSenders = new Map();
const finderAlertItems = new Map();
const assistantAttempts = new Map();

// Reference codes end in random characters, so a code is never handed out twice, even
// after the item that had it is deleted (an old QR sticker must not reach a new owner).
// Letters and digits that are easy to confuse (0/O, 1/I/L) are left out.
const REF_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function newRefCode(items, prefix, length) {
  const taken = new Set(items.map((item) => String(item.refCode || '').toUpperCase()));
  for (;;) {
    let suffix = '';
    for (let index = 0; index < length; index += 1) {
      suffix += REF_CODE_ALPHABET[crypto.randomInt(REF_CODE_ALPHABET.length)];
    }
    const refCode = `${prefix}-${suffix}`;
    if (!taken.has(refCode)) return refCode;
  }
}

// The year shown in a report's code follows Philippine time, not the server's.
function currentYear() {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric' }).format(new Date());
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
      : item.photo || item.imageUrl || '',
    date: item.date,
    createdAt: item.createdAt,
    status: item.status,
    claimed: Boolean(item.claimed),
    claimedAt: item.claimedAt || null,
    canResolve,
    canRequestClaim,
    potentialMatch: potentialMatch
      ? {
          id: potentialMatch.id,
          title: potentialMatch.title,
          location: potentialMatch.location,
          type: potentialMatch.type,
        }
      : null,
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
    actorRole: req.session?.user?.role || 'system',
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
  if (!lostId || !foundId || !Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) || !signature)
    return null;

  const payload = `${lostId}.${foundId}.${issuedAt}.${expiresAt}`;
  const expected = crypto.createHmac('sha256', matchReferenceSecret()).update(payload).digest('hex');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
    return null;
  return { lostId, foundId, issuedAt, expiresAt };
}

function getMatchReferenceStatus(foundItem, claims) {
  if (
    isItemClaimed(foundItem) ||
    claims.some((claim) => String(claim.itemId) === String(foundItem.id) && claim.status === 'approved')
  ) {
    return { key: 'approved', label: 'Approved for Claim' };
  }
  if (claims.some((claim) => String(claim.itemId) === String(foundItem.id) && claim.status === 'pending')) {
    return { key: 'review', label: 'Under Review' };
  }
  return { key: 'pending', label: 'Pending Verification' };
}

// The claimant's own non-rejected claim on this found item, if any - used to send
// them straight back to their claim conversation instead of the claim request form.
function findOwnClaimId(foundItem, claims, userId) {
  if (!userId) return null;
  const claim = claims.find(
    (entry) =>
      String(entry.itemId) === String(foundItem.id) &&
      String(entry.claimantId) === String(userId) &&
      entry.status !== 'rejected'
  );
  return claim ? claim.id : null;
}

// Either the owner (the matching lost item's reporter) or the finder (the found
// item's reporter) can open the claim conversation - whichever one this viewer is.
function matchRequesterRole(lost, found, userId) {
  if (!userId) return null;
  const isOwner = String(lost.reportedBy) === String(userId);
  const isFinder = String(found.reportedBy) === String(userId);
  if (isOwner && isFinder) return null;
  if (isOwner) return 'owner';
  if (isFinder) return 'finder';
  return null;
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
    'with',
    'case',
    'blue',
    'black',
    'item',
    'lost',
    'found',
    'cspc',
    'college',
    'the',
    'and',
    'for',
    'from',
    'near',
    'this',
    'that',
    'into',
    'onto',
    'there',
    'please',
    'return',
    'owner',
    'campus',
    'building',
    'student',
    'report',
    'reports',
  ]);

  return normalizeText(value)
    .split(' ')
    .filter((word) => word.length > 2 && !stopWords.has(word));
}

function computeTokenSimilarity(a, b) {
  const tokensA = tokenizeText(a);
  const tokensB = tokenizeText(b);

  if (!tokensA.length || !tokensB.length) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const intersection = [...setA].filter((token) => setB.has(token)).length;
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
  const overlap = [...tokensA].filter((token) => tokensB.has(token)).length;

  return overlap > 0 ? 1 : 0;
}

function scorePotentialMatch(item, other) {
  const categoryMatch = item.category && other.category && item.category === other.category;
  const locationA = normalizeText(item.location);
  const locationB = normalizeText(other.location);
  const sameLocation = !!(
    locationA &&
    locationB &&
    (locationA.includes(locationB.split(' ')[0]) ||
      locationB.includes(locationA.split(' ')[0]) ||
      locationA === locationB)
  );

  const nameSimilarity = computeTokenSimilarity(item.title, other.title);
  const descSimilarity = computeTokenSimilarity(
    item.desc || item.description || '',
    other.desc || other.description || ''
  );
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
    (meta.categoryMatch &&
      (hasStrongNameSimilarity || hasStrongDescriptionSimilarity || hasVerificationOverlap) &&
      meta.score >= 0.58) ||
    (!meta.categoryMatch && (hasStrongKeywordOverlap || hasStrongLocationAndKeywordOverlap))
  );
}

// Word-overlap scoring above misses pairs that describe the same item in different words
// ("blue Jansport bag" vs. "navy backpack" share no tokens). For same-category pairs, consult
// services/matchScorer's cache of Claude's semantic read on the pair, which catches those.
// A live AI call per pair would make every listing fetch far too slow, so a cache miss queues
// the pair for background scoring and falls back to the heuristic result for this request -
// the AI's answer is picked up on a later look rather than blocking this one.
function findMatches(item, allItems) {
  if (isItemClaimed(item)) return [];
  const targetType = item.type === 'lost' ? 'found' : 'lost';
  const candidates = allItems.filter(
    (other) => other.id !== item.id && other.type === targetType && !isItemClaimed(other)
  );

  return candidates
    .map((other) => {
      const meta = scorePotentialMatch(item, other);
      let aiScore = null;
      if (meta.categoryMatch && matchScorer.isConfigured()) {
        const cached = matchScorer.getCachedScore(item, other);
        if (cached) aiScore = cached.score;
        else matchScorer.queueScoring(item, other);
      }
      return {
        item: other,
        isMatch: isStrongPotentialMatch(meta) || (aiScore !== null && aiScore >= matchScorer.MATCH_THRESHOLD),
        rank: aiScore !== null ? Math.max(aiScore, meta.score) : meta.score,
      };
    })
    .filter((entry) => entry.isMatch)
    .sort((a, b) => b.rank - a.rank)
    .map((entry) => entry.item);
}

function findMatch(item, allItems) {
  return findMatches(item, allItems)[0] || null;
}

function addMatchLink(item, other, matchedAt) {
  if (!Array.isArray(item.matches)) item.matches = [];
  if (item.matches.some((match) => String(match.itemId) === String(other.id))) return;

  item.matches.push({
    itemId: other.id,
    refCode: other.refCode,
    type: other.type,
    status: 'possible',
    matchedAt,
  });
}

function createMatchNotification(lostItem, foundItem) {
  const notifications = Array.isArray(lostItem.notifications) ? lostItem.notifications : [];
  if (
    notifications.some(
      (notification) =>
        notification.notificationType === 'match' && String(notification.matchItemId) === String(foundItem.id)
    )
  ) {
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
    read: false,
  };
  lostItem.notifications = [notification, ...notifications].slice(0, 100);
  return notification;
}

function getStudentReporter(lostItem, users) {
  if (!lostItem.reportedBy || lostItem.reportedBy === 'guest') return null;
  return users.find((user) => String(user.id) === String(lostItem.reportedBy) && user.role !== 'admin') || null;
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
// The home page's stat boxes double as filters, so each count matches what that filter
// lists publicly: private registered belongings and archived reports are left out, and
// Lost/Found count only items that have not been claimed yet.
router.get('/stats', (req, res) => {
  const items = getItems().filter((i) => i.type !== 'registered' && i.status !== 'archived');
  const open = items.filter((i) => !isItemClaimed(i));

  res.json({
    success: true,
    stats: {
      total: items.length,
      lost: open.filter((i) => i.type === 'lost').length,
      found: open.filter((i) => i.type === 'found').length,
      claimed: items.filter(isItemClaimed).length,
    },
  });
});

// POST /api/items/assistant/parse - Turn a sentence into a draft report plus live matches.
//
// Reads only; nothing is saved here. The student reviews and edits the filled-in form and
// then submits through POST /api/items as usual, so every normal validation rule still runs.
// Available to guests, because most people reporting a lost item are not signed in yet.
router.post('/assistant/parse', async (req, res) => {
  const message = sanitizeString(req.body.message || '');
  if (message.length < 3) {
    return res.status(400).json({ success: false, message: 'Describe the item in a few words first.' });
  }
  if (message.length > 1000) {
    return res
      .status(400)
      .json({ success: false, message: 'That message is too long. Keep it under 1000 characters.' });
  }

  const limitKey = req.session?.user ? `account:${req.session.user.id}` : `network:${req.ip}`;
  const limit = req.session?.user ? ASSISTANT_ACCOUNT_LIMIT : ASSISTANT_GUEST_LIMIT;
  if (isRateLimited(assistantAttempts, limitKey, limit)) {
    return res.status(429).json({
      success: false,
      message: 'The assistant is busy right now. Wait a moment, or fill in the form directly.',
    });
  }
  recordAttempt(assistantAttempts, limitKey, limit);

  let result;
  try {
    result = await reportAssistant.parseReportMessage(message);
  } catch (error) {
    console.error('Report assistant failed:', error.message);
    return res
      .status(500)
      .json({ success: false, message: 'The assistant could not read that. Please fill in the form directly.' });
  }

  const review = reportAssistant.reviewDraft(result);

  // Preview matches against the unsaved draft, so the student sees a possible match before
  // submitting. Private registered belongings and archived reports stay out, exactly as in
  // the public listing.
  let matches = [];
  if (result.draft.type && result.draft.category && result.draft.title) {
    const items = getItems().filter((item) => item.type !== 'registered' && item.status !== 'archived');
    const probe = {
      id: '__assistant_draft__',
      type: result.draft.type,
      category: result.draft.category,
      title: result.draft.title,
      desc: result.draft.desc,
      location: result.draft.location,
      verification: '',
    };
    matches = findMatches(probe, items)
      .slice(0, 3)
      .map((item) => publicItemView(item));
  }

  res.json({
    success: true,
    engine: result.engine,
    draft: result.draft,
    confidence: result.confidence,
    evidence: result.evidence,
    missing: review.missing,
    uncertain: review.uncertain,
    question: review.question,
    ready: review.ready,
    matches,
  });
});

router.get('/claims', requireRole('admin'), (req, res) => {
  const claims = getClaims().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, claims });
});

// PATCH /api/items/claims/:claimId/seen - Dismiss a claim from this admin's bell
// notifications. Per-admin (not a global flag), so it doesn't affect the true
// pending count shown elsewhere (the Claims sidebar badge, the dashboard tile).
router.patch('/claims/:claimId/seen', requireRole('admin'), (req, res) => {
  const claims = getClaims();
  const claim = claims.find((entry) => entry.id === req.params.claimId);
  if (!claim) return res.status(404).json({ success: false, message: 'Claim not found.' });
  claim.seenByAdmin = Array.isArray(claim.seenByAdmin) ? claim.seenByAdmin : [];
  if (!claim.seenByAdmin.includes(req.session.user.id)) {
    claim.seenByAdmin.push(req.session.user.id);
    saveClaims(claims);
  }
  res.json({ success: true });
});

// DELETE /api/items/claims/:claimId - Admin cleanup of a claim record. Only removes
// the claim itself; an item the claim already marked claimed stays claimed, since
// deleting the record isn't the same as undoing a handover that may have happened.
router.delete('/claims/:claimId', requireRole('admin'), (req, res) => {
  const claims = getClaims();
  const index = claims.findIndex((entry) => entry.id === req.params.claimId);
  if (index === -1) return res.status(404).json({ success: false, message: 'Claim not found.' });
  claims.splice(index, 1);
  saveClaims(claims);
  res.json({ success: true, message: 'Claim deleted.' });
});

// POST /api/items/broadcast - Send an admin announcement to registered students and employees.
router.post('/broadcast', requireRole('admin'), async (req, res) => {
  const subject = sanitizeString(req.body.subject || '');
  const message = sanitizeString(req.body.message || '');
  if (subject.length < 3 || subject.length > 120 || message.length < 5 || message.length > 2000) {
    return res.status(400).json({ success: false, message: 'Subject or message length is invalid.' });
  }
  const recipients = readJsonArray(USERS_FILE).filter((user) => user.role !== 'admin' && user.email);
  let sent = 0;
  // Nothing to save; unlock the database so the site keeps working while the emails go out.
  await postgresStore.commitRequest();
  for (const user of recipients) {
    try {
      await sendBroadcastEmail(user, subject, message);
      sent += 1;
    } catch (error) {
      console.error('Broadcast email could not be sent:', error.message);
    }
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
    return res
      .status(400)
      .json({ success: false, message: 'A rejection reason between 5 and 500 characters is required.' });
  }

  const claims = getClaims();
  const claim = claims.find((entry) => entry.id === req.params.claimId);
  if (!claim) return res.status(404).json({ success: false, message: 'Claim request not found.' });
  if (claim.status !== 'pending') {
    return res.status(409).json({ success: false, message: 'This claim request has already been reviewed.' });
  }

  const items = getItems();
  const item = items.find((entry) => String(entry.id) === String(claim.itemId));
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
    message:
      status === 'approved'
        ? `Your claim for ${item.title} was approved.${pickupInstructions ? ` Pickup instructions: ${pickupInstructions}` : ''}`
        : `Your claim for ${item.title} was not approved. Reason: ${rejectionReason}`,
  };
  claim.handover =
    status === 'approved'
      ? {
          acknowledged: true,
          acknowledgedAt: claim.reviewedAt,
          acknowledgedBy: req.session.user.id,
          acknowledgedByName: req.session.user.fullName,
          signature: handoverSignature || req.session.user.fullName || 'Admin approval',
        }
      : null;
  if (status === 'approved') {
    item.claimed = true;
    item.status = 'claimed';
    item.claimedAt = claim.reviewedAt;
    item.claimantProof = claim.proof;
    claims.forEach((other) => {
      if (other.itemId === claim.itemId && other.id !== claim.id && other.status === 'pending') {
        other.status = 'rejected';
        other.reviewedAt = claim.reviewedAt;
        other.reviewedBy = req.session.user.id;
        other.rejectionReason = 'The item was approved for another claimant.';
        other.notification = {
          id: `claim-notif-${crypto.randomUUID()}`,
          timestamp: claim.reviewedAt,
          read: false,
          message: `Your claim for ${item.title} was not approved because the item was awarded to another claimant.`,
        };
      }
    });
  } else {
    item.claimed = false;
    item.status = 'active';
    item.claimedAt = null;
  }
  addItemActivity(
    item,
    req,
    status === 'approved' ? 'Claim approved' : 'Claim rejected',
    status === 'approved' ? pickupInstructions : rejectionReason
  );
  if (status === 'approved') {
    const lostItem = items.find((entry) => String(entry.id) === String(claim.lostItemId));
    if (lostItem && !lostItem.claimed) {
      lostItem.claimed = true;
      lostItem.status = 'claimed';
      lostItem.claimedAt = claim.reviewedAt;
      addItemActivity(lostItem, req, 'Claim approved', pickupInstructions);
    }
  }
  saveItems(items);
  saveClaims(claims);
  await postgresStore.commitRequest();

  if (claim.claimantEmail) {
    try {
      await sendClaimStatusEmail({ fullName: claim.claimantName, email: claim.claimantEmail }, item, claim, status);
    } catch (error) {
      console.error('Claim status email could not be sent:', error.message);
    }
  }

  const users = readJsonArray(USERS_FILE).filter(
    (user) =>
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
  const claim = claims.find((entry) => entry.id === req.params.claimId);
  if (!claim || claim.status !== 'approved')
    return res.status(404).json({ success: false, message: 'Approved claim not found.' });
  const signature = sanitizeString(req.body.signature || '');
  if (signature.length < 2 || signature.length > 120)
    return res.status(400).json({ success: false, message: 'A handover acknowledgment is required.' });
  claim.handover = {
    acknowledged: true,
    acknowledgedAt: new Date().toISOString(),
    acknowledgedBy: req.session.user.id,
    acknowledgedByName: req.session.user.fullName,
    signature,
  };
  saveClaims(claims);
  res.json({ success: true, handover: claim.handover });
});

// ── Handover meetup: live location sharing on an approved claim ────────────
// The owner (who claimed the item) and the finder (who reported it found) can ask
// each other for their current location to arrange the handover. Nothing is shared
// until the other person agrees; once shared, the sender's device keeps posting
// updated readings as they move, each one resetting the hour-long expiry, until
// either the hour passes with no new reading or the sender stops sharing.
//   claim.meetup[requesterId] = { status: 'pending' | 'shared' | 'declined' | 'stopped' | 'expired',
//                                 createdAt, respondedAt, location? }  (location = the other person's)
const MEETUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MEETUP_LOCATION_TTL_MS = 60 * 60 * 1000;
const MEETUP_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
const MEETUP_ASK_AGAIN_MS = 2 * 60 * 1000;

function firstName(fullName, fallback) {
  return (
    String(fullName || '')
      .trim()
      .split(/\s+/)[0] || fallback
  );
}

// Owner and finder of a non-rejected claim from the last 7 days, both with accounts.
// Location sharing is available as soon as a claim is filed (not gated behind
// approval any more - the two parties sort that out between themselves in the
// claim thread), and closes once the claim is rejected.
function meetupParties(claim, items, users) {
  if (claim.status === 'rejected') return null;
  if (Date.now() - Date.parse(claim.createdAt) > MEETUP_WINDOW_MS) return null;
  const item = items.find((entry) => String(entry.id) === String(claim.itemId));
  const owner = users.find((user) => String(user.id) === String(claim.claimantId));
  const finder = item && users.find((user) => String(user.id) === String(item.reportedBy));
  if (!owner || !finder || String(owner.id) === String(finder.id)) return null;
  return { owner, finder, item };
}

function claimConversationParties(claim, items, users) {
  if (claim.status === 'rejected') return null;
  const item = items.find((entry) => String(entry.id) === String(claim.itemId));
  const owner = users.find((user) => String(user.id) === String(claim.claimantId));
  const finder = item && users.find((user) => String(user.id) === String(item.reportedBy));
  if (!item || !owner || !finder || String(owner.id) === String(finder.id)) return null;
  return { owner, finder, item };
}

// Deletes expired locations and requests (and everything once the claim is
// rejected). Returns true when the claim changed and needs saving.
function pruneMeetup(claim, now = Date.now()) {
  if (!claim.meetup) return false;
  if (claim.status === 'rejected') {
    delete claim.meetup;
    return true;
  }
  let changed = false;
  Object.values(claim.meetup).forEach((request) => {
    if (request.location && Date.parse(request.location.expiresAt) <= now) {
      delete request.location;
      request.status = 'expired';
      changed = true;
    }
    if (request.status === 'pending' && now - Date.parse(request.createdAt) > MEETUP_REQUEST_TTL_MS) {
      request.status = 'expired';
      changed = true;
    }
  });
  return changed;
}

// Loads the claim for a meetup route and works out who is who; sends the error itself.
function loadMeetup(req, res) {
  const claims = getClaims();
  const claim = claims.find((entry) => entry.id === req.params.claimId);
  const parties = claim && meetupParties(claim, getItems(), readJsonArray(USERS_FILE));
  const userId = String(req.session.user.id);
  if (!parties || ![String(parties.owner.id), String(parties.finder.id)].includes(userId)) {
    res.status(404).json({ success: false, message: 'Location sharing is only available on your approved claims.' });
    return null;
  }
  if (pruneMeetup(claim)) saveClaims(claims);
  claim.meetup = claim.meetup || {};
  const me = userId === String(parties.owner.id) ? parties.owner : parties.finder;
  const other = me === parties.owner ? parties.finder : parties.owner;
  return { claims, claim, item: parties.item, me, other };
}

// POST /api/items/claims/:claimId/meetup/request - Ask the other person for their location.
router.post('/claims/:claimId/meetup/request', requireAuth, async (req, res) => {
  const context = loadMeetup(req, res);
  if (!context) return;
  const { claims, claim, item, me, other } = context;
  const otherName = firstName(other.fullName, 'The other person');
  const existing = claim.meetup[String(me.id)];
  if (existing?.status === 'pending') {
    return res.status(409).json({ success: false, message: `You already asked. Waiting for ${otherName} to respond.` });
  }
  if (existing?.status === 'shared') {
    return res
      .status(409)
      .json({ success: false, message: `${otherName} is already sharing their location with you.` });
  }
  if (existing?.status === 'declined') {
    const waitMs = MEETUP_ASK_AGAIN_MS - (Date.now() - Date.parse(existing.respondedAt));
    if (waitMs > 0) {
      return res.status(429).json({
        success: false,
        retryAfter: Math.ceil(waitMs / 1000),
        message: `${otherName} declined. You can ask again in ${Math.ceil(waitMs / 60000)} minute(s).`,
      });
    }
  }

  claim.meetup[String(me.id)] = { status: 'pending', createdAt: new Date().toISOString() };
  saveClaims(claims);
  await postgresStore.commitRequest();
  try {
    await sendMeetupRequestEmail(other, me.fullName || 'The other person', item.title);
  } catch (error) {
    console.error('Location request email could not be sent:', error.message);
  }
  if (other.messengerPsid) {
    const requesterName = firstName(me.fullName, 'The other person');
    messenger
      .sendMessengerText(
        other.messengerPsid,
        `${requesterName} asked for your current location to meet and hand over "${item.title}". Sign in to Back2You and open your notifications (the bell icon) to respond.`
      )
      .catch((error) => console.error('Location request Messenger alert could not be sent:', error.message));
  }
  res.status(201).json({ success: true, message: `We asked ${otherName} to share their location.` });
});

// POST /api/items/claims/:claimId/meetup/respond - Share my location (once, and again
// as I move while sharing stays on), or decline.
router.post('/claims/:claimId/meetup/respond', requireAuth, (req, res) => {
  const context = loadMeetup(req, res);
  if (!context) return;
  const { claims, claim, other } = context;
  const request = claim.meetup[String(other.id)];
  // A later 'share' call while already 'shared' is a live-tracking update, not a
  // fresh response to a request - the request only stays 'pending' once.
  const isTrackingUpdate = request?.status === 'shared' && req.body.action === 'share';
  if (!request || (request.status !== 'pending' && !isTrackingUpdate)) {
    return res.status(404).json({ success: false, message: 'There is no location request waiting for you.' });
  }
  const now = new Date();

  if (req.body.action === 'decline') {
    request.status = 'declined';
    request.respondedAt = now.toISOString();
    saveClaims(claims);
    return res.json({ success: true, message: 'You declined to share your location.' });
  }
  if (req.body.action !== 'share') {
    return res.status(400).json({ success: false, message: 'Choose to share your location or decline.' });
  }

  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  const accuracy = Number(req.body.accuracy);
  const incomingNote = sanitizeString(req.body.note || '');
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return res.status(400).json({ success: false, message: 'Your location could not be read. Please try again.' });
  }
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 5000) {
    return res.status(400).json({
      success: false,
      message: 'Your location is too imprecise to share. Turn on GPS or move near a window and try again.',
    });
  }
  if (incomingNote.length > 160) {
    return res.status(400).json({ success: false, message: 'The note must be 160 characters or fewer.' });
  }
  // A background tracking update carries no new note text - keep whatever note was
  // last shared instead of blanking it out.
  const note = incomingNote || (isTrackingUpdate ? request.location?.note || '' : '');

  request.status = 'shared';
  request.respondedAt = now.toISOString();
  request.location = {
    latitude: Math.round(latitude * 1e6) / 1e6,
    longitude: Math.round(longitude * 1e6) / 1e6,
    accuracy: Math.round(accuracy),
    note,
    sharedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + MEETUP_LOCATION_TTL_MS).toISOString(),
  };
  saveClaims(claims);
  res.json({
    success: true,
    message: isTrackingUpdate
      ? 'Location updated.'
      : `Your location is shared with ${firstName(other.fullName, 'them')} for one hour, and will keep updating as you move.`,
    expiresAt: request.location.expiresAt,
  });
});

// POST /api/items/claims/:claimId/meetup/stop - Delete the location I shared.
router.post('/claims/:claimId/meetup/stop', requireAuth, (req, res) => {
  const context = loadMeetup(req, res);
  if (!context) return;
  const { claims, claim, other } = context;
  const request = claim.meetup[String(other.id)];
  if (!request?.location) {
    return res.status(404).json({ success: false, message: 'You are not sharing your location.' });
  }
  delete request.location;
  request.status = 'stopped';
  request.respondedAt = new Date().toISOString();
  saveClaims(claims);
  res.json({ success: true, message: 'You stopped sharing your location. It has been deleted.' });
});

// ── Claim thread: direct messages + mutual confirmation ────────────────────
// Lets the claimant and the finder of a (non-rejected) claim message each other to
// agree the item matches, then each confirm the handover once it has happened.
// Replaces the old admin-approval step: the item is marked claimed only once both
// sides here have confirmed it.
const CLAIM_THREAD_TTL_MS = 24 * 60 * 60 * 1000;

// Either side can delete the conversation once resolved (DELETE route below), and
// if neither bothers, it clears itself out a day after resolution - mirrors the
// lazy, prune-on-access pattern pruneMeetup already uses for shared locations.
function pruneClaimThread(claim, now = Date.now()) {
  if (claim.status !== 'approved' || !Array.isArray(claim.messages) || !claim.messages.length) return false;
  if (now - Date.parse(claim.reviewedAt || claim.createdAt) <= CLAIM_THREAD_TTL_MS) return false;
  claim.messages = [];
  return true;
}

function loadClaimThread(req, res) {
  const claims = getClaims();
  const claim = claims.find((entry) => entry.id === req.params.claimId);
  const items = getItems();
  const item = claim && items.find((entry) => String(entry.id) === String(claim.itemId));
  const users = item && readJsonArray(USERS_FILE);
  const claimant = users && users.find((user) => String(user.id) === String(claim.claimantId));
  const finder = users && users.find((user) => String(user.id) === String(item.reportedBy));
  const userId = String(req.session.user.id);
  if (
    !claim ||
    claim.status === 'rejected' ||
    !claimant ||
    !finder ||
    ![String(claimant.id), String(finder.id)].includes(userId)
  ) {
    res.status(404).json({ success: false, message: 'Claim conversation not found.' });
    return null;
  }
  claim.messages = Array.isArray(claim.messages) ? claim.messages : [];
  claim.confirmations = Array.isArray(claim.confirmations) ? claim.confirmations : [];
  claim.lastReadAt = claim.lastReadAt && typeof claim.lastReadAt === 'object' ? claim.lastReadAt : {};
  let changed = pruneClaimThread(claim);
  // Loading the thread at all - whether to read it, send a message or confirm -
  // means you've seen everything in it so far, so the unread-messages bell
  // notification clears the moment you open the conversation.
  const previousRead = claim.lastReadAt[userId];
  const now = new Date().toISOString();
  if (!previousRead || claim.messages.some((entry) => Date.parse(entry.createdAt) > Date.parse(previousRead))) {
    claim.lastReadAt[userId] = now;
    changed = true;
  }
  if (changed) saveClaims(claims);
  const me = userId === String(claimant.id) ? claimant : finder;
  const other = me === claimant ? finder : claimant;
  return { claims, claim, items, item, me, other };
}

function claimThreadView(claim, item, me, other) {
  return {
    success: true,
    claim: { id: claim.id, status: claim.status },
    item: { id: item.id, title: item.title },
    otherName: other.fullName || 'The other person',
    messages: claim.messages.map((entry) => ({
      id: entry.id,
      text: entry.text,
      mine: String(entry.senderId) === String(me.id),
      createdAt: entry.createdAt,
    })),
    confirmedByMe: claim.confirmations.includes(String(me.id)),
    confirmedByOther: claim.confirmations.includes(String(other.id)),
  };
}

// GET /api/items/claims/:claimId/thread - Load the conversation for a claim.
router.get('/claims/:claimId/thread', requireAuth, (req, res) => {
  const context = loadClaimThread(req, res);
  if (!context) return;
  const { claim, item, me, other } = context;
  res.json(claimThreadView(claim, item, me, other));
});

// POST /api/items/claims/:claimId/thread/messages - Send a message in the conversation.
router.post('/claims/:claimId/thread/messages', requireAuth, (req, res) => {
  const context = loadClaimThread(req, res);
  if (!context) return;
  const { claims, claim, item, me, other } = context;
  if (claim.status === 'approved' || claim.status === 'returned') {
    return res.status(409).json({ success: false, message: 'This claim is complete. The conversation is read-only.' });
  }
  const text = sanitizeString(req.body.text || '');
  if (text.length < 1 || text.length > 500) {
    return res.status(400).json({ success: false, message: 'Message must be 1-500 characters.' });
  }
  claim.messages.push({ id: `msg-${crypto.randomUUID()}`, senderId: me.id, text, createdAt: new Date().toISOString() });
  saveClaims(claims);
  res.status(201).json(claimThreadView(claim, item, me, other));
});

// POST /api/items/claims/:claimId/thread/confirm - Confirm the item has been handed over.
// Once both the claimant and the finder have confirmed, the item is marked claimed.
router.post('/claims/:claimId/thread/confirm', requireAuth, async (req, res) => {
  const context = loadClaimThread(req, res);
  if (!context) return;
  const { claims, claim, items, item, me, other } = context;
  if (!claim.confirmations.includes(String(me.id))) claim.confirmations.push(String(me.id));
  const bothConfirmed =
    claim.confirmations.includes(String(claim.claimantId)) && claim.confirmations.includes(String(item.reportedBy));
  const justResolved = bothConfirmed && claim.status !== 'approved';

  if (justResolved) {
    const now = new Date().toISOString();
    item.claimed = true;
    item.status = 'claimed';
    item.claimedAt = now;
    item.claimantProof = claim.proof;
    claim.status = 'approved';
    claim.reviewedAt = now;
    claim.reviewedBy = 'mutual-confirmation';
    claims.forEach((rival) => {
      if (rival.itemId === claim.itemId && rival.id !== claim.id && rival.status === 'pending') {
        rival.status = 'rejected';
        rival.reviewedAt = now;
        rival.rejectionReason = 'The item was claimed by another claimant.';
      }
    });
    addItemActivity(item, req, 'Claim confirmed by both parties', '');
    // The matching lost report is resolved too - without this it would keep sitting
    // in the Lost tab forever, even though the owner already has their item back.
    const lostItem = items.find((entry) => String(entry.id) === String(claim.lostItemId));
    if (lostItem && !lostItem.claimed) {
      lostItem.claimed = true;
      lostItem.status = 'claimed';
      lostItem.claimedAt = now;
      addItemActivity(lostItem, req, 'Claim confirmed by both parties', '');
    }
    saveItems(items);
  }
  saveClaims(claims);
  await postgresStore.commitRequest();

  if (justResolved && claim.claimantEmail) {
    try {
      await sendClaimStatusEmail({ fullName: claim.claimantName, email: claim.claimantEmail }, item, claim, 'approved');
    } catch (error) {
      console.error('Claim status email could not be sent:', error.message);
    }
  }

  res.json(claimThreadView(claim, item, me, other));
});

// DELETE /api/items/claims/:claimId/thread - Clear the conversation once it's resolved.
// The claim record itself (and the item's claimed status) is kept; only the back-and-forth
// messages are wiped, since either side may ask for this once the handover is done.
router.delete('/claims/:claimId/thread', requireAuth, (req, res) => {
  const context = loadClaimThread(req, res);
  if (!context) return;
  const { claims, claim } = context;
  if (claim.status !== 'approved') {
    return res
      .status(409)
      .json({ success: false, message: 'The conversation can be deleted once the claim is resolved.' });
  }
  claim.messages = [];
  saveClaims(claims);
  res.json({ success: true, message: 'Conversation deleted.' });
});

// Inbox entry describing both directions of a meetup for one person.
function meetupNotification(claim, item, me, other, isOwner) {
  const meetup = claim.meetup || {};
  const mine = meetup[String(me.id)]; // my request: their location for me
  const theirs = meetup[String(other.id)]; // their request: my location for them
  // claim.reviewedAt is only set once approved - for a still-pending claim with no
  // meetup activity yet, fall back to claim.createdAt so this always has a time.
  const times = [
    claim.reviewedAt,
    claim.createdAt,
    mine?.createdAt,
    mine?.respondedAt,
    theirs?.createdAt,
    theirs?.respondedAt,
  ]
    .filter(Boolean)
    .map(Date.parse);
  return {
    id: `meetup-${claim.id}`,
    notificationType: 'meetup',
    claimId: claim.id,
    itemId: item.id,
    itemTitle: item.title,
    refCode: item.refCode,
    role: isOwner ? 'owner' : 'finder',
    otherName: firstName(other.fullName, isOwner ? 'The finder' : 'The owner'),
    timestamp: new Date(Math.max(...times)).toISOString(),
    read: theirs?.status !== 'pending',
    theirLocation: {
      status: mine?.status || 'none',
      askAgainAt:
        mine?.status === 'declined' ? new Date(Date.parse(mine.respondedAt) + MEETUP_ASK_AGAIN_MS).toISOString() : null,
      location: mine?.status === 'shared' ? mine.location : null,
    },
    myLocation: {
      status: theirs?.status || 'none',
      expiresAt: theirs?.location?.expiresAt || null,
    },
  };
}

// Persistent conversation entry for one participant. Unread means messages the
// other side sent since this person last opened the conversation.
function claimConversationNotification(claim, item, me, other) {
  const messages = Array.isArray(claim.messages) ? claim.messages : [];
  const lastRead = claim.lastReadAt?.[String(me.id)];
  const unread = messages.filter(
    (entry) =>
      String(entry.senderId) !== String(me.id) && (!lastRead || Date.parse(entry.createdAt) > Date.parse(lastRead))
  );
  const latest = messages[messages.length - 1];
  return {
    id: `claim-conversation-${claim.id}`,
    notificationType: 'claim-conversation',
    claimId: claim.id,
    itemId: item.id,
    itemTitle: item.title,
    refCode: item.refCode,
    otherName: firstName(other.fullName, 'The other person'),
    message: latest?.text || '',
    unreadCount: unread.length,
    status: claim.status,
    timestamp: latest?.createdAt || claim.createdAt,
    read: unread.length === 0,
  };
}

// GET /api/items - Retrieve items with filters
router.get('/', (req, res) => {
  let items = getItems();
  const { type, location, search, category, status } = req.query;

  // Registered belongings isolation: only owner can see their registered belongings
  if (type === 'registered') {
    if (!req.session?.user) {
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required to view registered belongings.' });
    }
    items = items.filter(
      (i) => i.type === 'registered' && (i.reportedBy === req.session.user.id || req.session.user.role === 'admin')
    );
  } else {
    // Public feed strictly excludes private preventive belongings
    items = items.filter(
      (i) => i.type !== 'registered' && (req.session?.user?.role === 'admin' || i.status !== 'archived')
    );
  }

  // Type filter: lost | found
  if (type && ['lost', 'found'].includes(type)) {
    items = items.filter((i) => i.type === type && !isItemClaimed(i));
  }

  // Status filter: claimed | active | archived
  if (status === 'claimed') {
    items = items.filter(isItemClaimed);
  } else if (status === 'archived') {
    items = items.filter((i) => i.status === 'archived');
  } else if (status === 'active') {
    items = items.filter((i) => !isItemClaimed(i));
  }

  // Category filter
  if (category) {
    items = items.filter((i) => (i.category || '').toLowerCase() === category.toLowerCase());
  }

  // Location filter
  if (location) {
    const locFilter = location.toLowerCase();
    items = items.filter((i) => (i.location || '').toLowerCase().includes(locFilter));
  }

  // Search keyword filter
  if (search) {
    const q = search.toLowerCase().trim();
    items = items.filter(
      (i) =>
        (i.title || '').toLowerCase().includes(q) ||
        (i.desc || i.description || '').toLowerCase().includes(q) ||
        (i.location || '').toLowerCase().includes(q) ||
        (i.category || '').toLowerCase().includes(q) ||
        (i.refCode && i.refCode.toLowerCase().includes(q))
    );
  }

  // Attach match previews for active items
  const allItems = getItems();
  const enhancedItems = items.map((item) => {
    const match = findMatch(item, allItems);
    const user = req.session?.user;
    const canViewPrivateFields = user && (user.role === 'admin' || item.reportedBy === user.id);
    const canRequestClaim = Boolean(
      user &&
      item.type === 'found' &&
      !item.claimed &&
      match?.type === 'lost' &&
      String(match.reportedBy) === String(user.id)
    );
    return canViewPrivateFields
      ? {
          ...item,
          canResolve: true,
          canRequestClaim,
          potentialMatch: match
            ? { id: match.id, title: match.title, location: match.location, type: match.type }
            : null,
        }
      : publicItemView(
          item,
          match,
          Boolean(user && (user.role === 'admin' || String(item.reportedBy) === String(user.id))),
          canRequestClaim
        );
  });

  res.json({
    success: true,
    count: enhancedItems.length,
    items: enhancedItems,
  });
});

// GET /api/items/qr-lookup/:refCode - Public lookup for finder scanning QR (privacy-safe, NO phone/email returned)
router.get('/qr-lookup/:refCode', (req, res) => {
  const items = getItems();
  const searchRef = req.params.refCode.toUpperCase().trim();
  const item = items.find((i) => i.refCode && i.refCode.toUpperCase().trim() === searchRef);

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
      instructions: item.instructions || '',
      isRegisteredBelonging: item.type === 'registered',
      isOwnReport:
        ['lost', 'found'].includes(item.type) &&
        Boolean(req.session?.user && String(item.reportedBy) === String(req.session.user.id)),
    },
  });
});

// POST /api/items/anonymous-notify - Public finder messaging (delivers alert straight to owner's account)
router.post('/anonymous-notify', async (req, res) => {
  try {
    const { refCode, message, locationFound, finderContact, conversationToken } = req.body;
    const submissionKey = req.get('Idempotency-Key')?.trim();
    if (!refCode || !message) {
      return res.status(400).json({ success: false, message: 'Reference code and message are required.' });
    }
    if (conversationToken && !/^[a-f0-9]{64}$/i.test(conversationToken)) {
      return res.status(400).json({ success: false, message: 'Invalid finder conversation token.' });
    }
    if (submissionKey && !/^[A-Za-z0-9_-]{16,128}$/.test(submissionKey)) {
      return res.status(400).json({ success: false, message: 'Invalid finder alert submission key.' });
    }
    if (
      String(message).length > 1000 ||
      String(locationFound || '').length > 150 ||
      String(finderContact || '').length > 150
    ) {
      return res.status(400).json({ success: false, message: 'Finder message fields exceed the allowed length.' });
    }
    if (isRateLimited(finderAlertSenders, req.ip, FINDER_ALERT_SENDER_LIMIT)) {
      return res
        .status(429)
        .json({ success: false, message: 'Too many alerts were sent from this network. Please try again later.' });
    }

    const items = getItems();
    const searchRef = String(refCode).toUpperCase().trim();
    const targetItem = items.find((i) => i.refCode && i.refCode.toUpperCase().trim() === searchRef);
    if (
      targetItem &&
      ['lost', 'found'].includes(targetItem.type) &&
      req.session?.user &&
      String(targetItem.reportedBy) === String(req.session.user.id)
    ) {
      return res
        .status(403)
        .json({ success: false, message: 'You cannot send a finder alert to a report you submitted.' });
    }
    const submissionFingerprint = finderSubmissionFingerprint(
      searchRef,
      message,
      locationFound || '',
      finderContact || ''
    );
    const previousSubmission = findFinderSubmission(items, submissionKey);
    if (previousSubmission) {
      if (previousSubmission.submissionFingerprint !== submissionFingerprint) {
        return res
          .status(409)
          .json({ success: false, message: 'This finder alert key was already used for a different alert.' });
      }
      if (
        conversationToken &&
        previousSubmission.conversation &&
        previousSubmission.conversation.tokenHash !== finderConversationTokenHash(conversationToken)
      ) {
        return res
          .status(409)
          .json({ success: false, message: 'This finder alert key was already used for a different conversation.' });
      }
      return res.json({
        success: true,
        duplicate: true,
        message: 'This alert was already sent to the owner.',
        notification: publicFinderNotification(previousSubmission),
        ...(conversationToken && previousSubmission.conversation
          ? {
              conversation: {
                id: previousSubmission.id,
                token: conversationToken,
                expiresAt: previousSubmission.conversation.expiresAt,
              },
            }
          : {}),
      });
    }

    const itemIndex = items.findIndex((i) => i.refCode && i.refCode.toUpperCase().trim() === searchRef);

    if (itemIndex === -1) {
      return res.status(404).json({ success: false, message: 'Item not found with this reference code.' });
    }

    const item = items[itemIndex];
    const isClaimed = Boolean(item.claimed || item.status === 'claimed');
    const canReceiveFinderAlert = item.type === 'registered' || (['lost', 'found'].includes(item.type) && !isClaimed);
    if (!canReceiveFinderAlert) {
      return res.status(404).json({ success: false, message: 'This item can no longer receive finder alerts.' });
    }
    if (isRateLimited(finderAlertItems, String(item.id), FINDER_ALERT_ITEM_LIMIT)) {
      return res.status(429).json({
        success: false,
        message: 'The owner has already received several alerts about this item. Please try again later.',
      });
    }
    if (!item.notifications) item.notifications = [];

    const newNotification = {
      id: `notif-${crypto.randomUUID()}`,
      refCode: item.refCode,
      itemTitle: item.title,
      message: sanitizeString(message),
      locationFound: sanitizeString(locationFound || 'Campus area'),
      finderContact: sanitizeString(finderContact || 'Anonymous Student / Finder'),
      timestamp: new Date().toISOString(),
      read: false,
      ...(conversationToken
        ? {
            conversation: {
              tokenHash: finderConversationTokenHash(conversationToken),
              status: 'open',
              createdAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + REGISTERED_CONVERSATION_TTL_MS).toISOString(),
              messages: [
                {
                  id: `msg-${crypto.randomUUID()}`,
                  sender: 'finder',
                  text: sanitizeString(message).slice(0, 500),
                  createdAt: new Date().toISOString(),
                },
              ],
              confirmations: [],
              meetup: {},
            },
          }
        : {}),
      ...(submissionKey ? { submissionKey, submissionFingerprint } : {}),
    };

    item.notifications.unshift(newNotification);
    item.notifications = item.notifications.slice(0, 100);
    saveItems(items);
    recordAttempt(finderAlertSenders, req.ip, FINDER_ALERT_SENDER_LIMIT);
    recordAttempt(finderAlertItems, String(item.id), FINDER_ALERT_ITEM_LIMIT);
    await postgresStore.commitRequest();

    const owner = item.ownerEmail
      ? { email: item.ownerEmail, fullName: item.ownerName }
      : readJsonArray(USERS_FILE).find((user) => String(user.id) === String(item.reportedBy));

    let emailSent = false;
    try {
      if (!owner?.email) throw new Error('Registered item has no owner email address.');
      await sendFinderNotificationEmail(owner, item, newNotification);
      emailSent = true;
    } catch (error) {
      console.error('Finder alert email could not be sent:', error.message);
    }
    if (owner?.messengerPsid) {
      messenger
        .sendMessengerText(
          owner.messengerPsid,
          `Someone scanned the QR code on your item "${item.title}" (${item.refCode}) and says they found it. Sign in to Back2You and open your notifications (the bell icon) to see their message.`
        )
        .catch((error) => console.error('QR scan Messenger alert could not be sent:', error.message));
    }

    res.json({
      success: true,
      message: emailSent
        ? "Finder alert saved to the owner's inbox and sent by email."
        : "Finder alert saved to the owner's inbox, but email delivery is unavailable.",
      emailSent,
      itemTitle: item.title,
      notification: publicFinderNotification(newNotification),
      ...(conversationToken
        ? {
            conversation: {
              id: newNotification.id,
              token: conversationToken,
              expiresAt: newNotification.conversation.expiresAt,
            },
          }
        : {}),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to deliver notification.' });
  }
});

router.get(
  '/registered-conversations/:conversationId',
  requireAuth,
  registeredConversationHandler('owner', async (context, req, res) => {
    let changed = false;
    if (!context.notification.read) {
      context.notification.read = true;
      changed = true;
    }
    if (pruneRegisteredConversationMeetup(context.conversation)) changed = true;
    if (changed) {
      saveItems(context.items);
      await postgresStore.commitRequest();
    }
    res.json(registeredConversationView(context));
  })
);

router.get(
  '/registered-conversations/:conversationId/guest',
  registeredConversationHandler('finder', (context, req, res) => {
    if (pruneRegisteredConversationMeetup(context.conversation)) {
      saveItems(context.items);
      return postgresStore.commitRequest().then(() => res.json(registeredConversationView(context)));
    }
    res.json(registeredConversationView(context));
  })
);

function sendRegisteredConversationMessage(role) {
  return registeredConversationHandler(role, async (context, req, res) => {
    const { conversation } = context;
    if (conversation.status !== 'open') {
      return res.status(409).json({ success: false, message: 'This conversation has been resolved.' });
    }
    const senderKey = `${context.notification.id}:${role}`;
    if (isRateLimited(registeredConversationAttempts, senderKey, REGISTERED_CONVERSATION_MESSAGE_LIMIT)) {
      return res.status(429).json({ success: false, message: 'Too many messages were sent. Please try again later.' });
    }
    const text = sanitizeString(req.body.text || '');
    if (text.length < 1 || text.length > 500) {
      return res.status(400).json({ success: false, message: 'Message must be 1-500 characters.' });
    }
    conversation.messages.push({
      id: `msg-${crypto.randomUUID()}`,
      sender: role,
      text,
      createdAt: new Date().toISOString(),
    });
    conversation.messages = conversation.messages.slice(-500);
    if (role === 'finder') context.notification.read = false;
    saveItems(context.items);
    await postgresStore.commitRequest();
    res.status(201).json(registeredConversationView(context));
  });
}

router.post(
  '/registered-conversations/:conversationId/messages',
  requireAuth,
  sendRegisteredConversationMessage('owner')
);
router.post('/registered-conversations/:conversationId/guest/messages', sendRegisteredConversationMessage('finder'));

function confirmRegisteredConversation(role) {
  return registeredConversationHandler(role, async (context, req, res) => {
    const { conversation } = context;
    if (conversation.status === 'open') {
      conversation.confirmations = Array.isArray(conversation.confirmations) ? conversation.confirmations : [];
      if (!conversation.confirmations.includes(role)) conversation.confirmations.push(role);
      if (conversation.confirmations.includes('owner') && conversation.confirmations.includes('finder')) {
        conversation.status = 'returned';
        conversation.returnedAt = new Date().toISOString();
      }
      saveItems(context.items);
      await postgresStore.commitRequest();
    }
    res.json(registeredConversationView(context));
  });
}

router.post('/registered-conversations/:conversationId/confirm', requireAuth, confirmRegisteredConversation('owner'));
router.post('/registered-conversations/:conversationId/guest/confirm', confirmRegisteredConversation('finder'));

function registeredMeetupAction(role) {
  return registeredConversationHandler(role, async (context, req, res) => {
    const { conversation, item, notification } = context;
    if (conversation.status !== 'open') {
      return res.status(409).json({ success: false, message: 'This conversation has been resolved.' });
    }
    let changed = pruneRegisteredConversationMeetup(conversation);
    conversation.meetup = conversation.meetup || {};
    const otherRole = role === 'owner' ? 'finder' : 'owner';
    const action = req.params.action;
    let isTrackingUpdate = false;

    if (action === 'request') {
      const existing = conversation.meetup[role];
      if (existing?.status === 'pending') {
        return res
          .status(409)
          .json({ success: false, message: 'Your location request is already waiting for a response.' });
      }
      if (existing?.status === 'shared') {
        return res.status(409).json({ success: false, message: 'The other person has already shared their location.' });
      }
      if (existing?.status === 'declined') {
        const waitMs = MEETUP_ASK_AGAIN_MS - (Date.now() - Date.parse(existing.respondedAt));
        if (waitMs > 0) {
          return res.status(429).json({
            success: false,
            retryAfter: Math.ceil(waitMs / 1000),
            message: `You can ask again in ${Math.ceil(waitMs / 60000)} minute(s).`,
          });
        }
      }
      conversation.meetup[role] = { status: 'pending', createdAt: new Date().toISOString() };
      changed = true;
    } else if (action === 'respond') {
      const request = conversation.meetup[otherRole];
      // A later 'share' call while already 'shared' is a live-tracking update, not a
      // fresh response to a request - the request only stays 'pending' once.
      isTrackingUpdate = request?.status === 'shared' && req.body.action === 'share';
      if (!request || (request.status !== 'pending' && !isTrackingUpdate)) {
        return res.status(404).json({ success: false, message: 'There is no location request waiting for you.' });
      }
      const now = new Date();
      if (req.body.action === 'decline') {
        request.status = 'declined';
        request.respondedAt = now.toISOString();
        changed = true;
      } else if (req.body.action === 'share') {
        const latitude = Number(req.body.latitude);
        const longitude = Number(req.body.longitude);
        const accuracy = Number(req.body.accuracy);
        const incomingNote = sanitizeString(req.body.note || '');
        if (
          !Number.isFinite(latitude) ||
          latitude < -90 ||
          latitude > 90 ||
          !Number.isFinite(longitude) ||
          longitude < -180 ||
          longitude > 180
        ) {
          return res
            .status(400)
            .json({ success: false, message: 'Your location could not be read. Please try again.' });
        }
        if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 5000) {
          return res.status(400).json({
            success: false,
            message: 'Your location is too imprecise to share. Turn on GPS or move near a window and try again.',
          });
        }
        if (incomingNote.length > 160) {
          return res.status(400).json({ success: false, message: 'The note must be 160 characters or fewer.' });
        }
        // A background tracking update carries no new note text - keep whatever note
        // was last shared instead of blanking it out.
        const note = incomingNote || (isTrackingUpdate ? request.location?.note || '' : '');
        request.status = 'shared';
        request.respondedAt = now.toISOString();
        request.location = {
          latitude: Math.round(latitude * 1e6) / 1e6,
          longitude: Math.round(longitude * 1e6) / 1e6,
          accuracy: Math.round(accuracy),
          note,
          sharedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + MEETUP_LOCATION_TTL_MS).toISOString(),
        };
        changed = true;
      } else {
        return res.status(400).json({ success: false, message: 'Choose to share your location or decline.' });
      }
    } else if (action === 'stop') {
      const request = conversation.meetup[otherRole];
      if (!request?.location) {
        return res.status(404).json({ success: false, message: 'You are not sharing your location.' });
      }
      delete request.location;
      request.status = 'stopped';
      request.respondedAt = new Date().toISOString();
      changed = true;
    } else {
      return res.status(404).json({ success: false, message: 'Location action not found.' });
    }

    if (changed) {
      saveItems(context.items);
      await postgresStore.commitRequest();
    }
    const recipient = role === 'owner' ? 'the anonymous finder' : item.ownerName || 'the owner';
    res.json({
      success: true,
      message:
        action === 'request'
          ? `We asked ${recipient} to share their location.`
          : action === 'stop'
            ? 'You stopped sharing your location. It has been deleted.'
            : req.body.action === 'decline'
              ? 'You declined to share your location.'
              : isTrackingUpdate
                ? 'Location updated.'
                : `Your location is shared with ${recipient} for one hour, and will keep updating as you move.`,
      conversation: registeredConversationView(context),
    });
  });
}

router.post('/registered-conversations/:conversationId/meetup/:action', requireAuth, registeredMeetupAction('owner'));
router.post('/registered-conversations/:conversationId/guest/meetup/:action', registeredMeetupAction('finder'));

// POST /api/items/match-reference-notify - Anonymous alert for a scanned match QR.
router.post('/match-reference-notify', async (req, res) => {
  try {
    const { token, message, locationFound, finderContact } = req.body;
    const submissionKey = req.get('Idempotency-Key')?.trim();
    if (!token || !message) {
      return res.status(400).json({ success: false, message: 'Match reference and message are required.' });
    }
    if (submissionKey && !/^[A-Za-z0-9_-]{16,128}$/.test(submissionKey)) {
      return res.status(400).json({ success: false, message: 'Invalid finder alert submission key.' });
    }
    if (
      String(message).length > 1000 ||
      String(locationFound || '').length > 150 ||
      String(finderContact || '').length > 150
    ) {
      return res.status(400).json({ success: false, message: 'Finder message fields exceed the allowed length.' });
    }
    if (isRateLimited(finderAlertSenders, req.ip, FINDER_ALERT_SENDER_LIMIT)) {
      return res
        .status(429)
        .json({ success: false, message: 'Too many alerts were sent from this network. Please try again later.' });
    }

    const reference = parseMatchReferenceToken(token);
    if (!reference || reference.expiresAt < Date.now()) {
      return res.status(410).json({ success: false, message: 'This match reference has expired or is invalid.' });
    }

    const items = getItems();
    const submissionFingerprint = finderSubmissionFingerprint(token, message, locationFound || '', finderContact || '');
    const previousSubmission = findFinderSubmission(items, submissionKey);
    if (previousSubmission) {
      if (previousSubmission.submissionFingerprint !== submissionFingerprint) {
        return res
          .status(409)
          .json({ success: false, message: 'This finder alert key was already used for a different alert.' });
      }
      return res.json({
        success: true,
        duplicate: true,
        message: 'This alert was already sent to the owner.',
        notification: publicFinderNotification(previousSubmission),
      });
    }

    const lost = items.find((item) => String(item.id) === String(reference.lostId));
    const found = items.find((item) => String(item.id) === String(reference.foundId));
    if (!lost || !found || lost.type !== 'lost' || found.type !== 'found') {
      return res.status(404).json({ success: false, message: 'The matched reports are no longer available.' });
    }
    if (!findMatches(lost, items).some((match) => String(match.id) === String(found.id))) {
      return res.status(403).json({ success: false, message: 'This item pair is no longer an available match.' });
    }

    const owner = getStudentReporter(lost, readJsonArray(USERS_FILE));
    if (!owner) {
      return res.status(404).json({ success: false, message: 'The lost-item owner account could not be found.' });
    }
    if (isRateLimited(finderAlertItems, String(lost.id), FINDER_ALERT_ITEM_LIMIT)) {
      return res.status(429).json({
        success: false,
        message: 'The owner has already received several alerts about this item. Please try again later.',
      });
    }

    const notification = {
      id: `notif-${crypto.randomUUID()}`,
      notificationType: 'finder',
      itemTitle: lost.title,
      refCode: lost.refCode,
      matchItemId: found.id,
      matchItemTitle: found.title,
      matchRefCode: found.refCode,
      message: sanitizeString(message),
      locationFound: sanitizeString(locationFound || 'Campus area'),
      finderContact: sanitizeString(finderContact || 'Anonymous Student / Finder'),
      timestamp: new Date().toISOString(),
      read: false,
      ...(submissionKey ? { submissionKey, submissionFingerprint } : {}),
    };

    lost.notifications = [notification, ...(Array.isArray(lost.notifications) ? lost.notifications : [])].slice(0, 100);
    saveItems(items);
    recordAttempt(finderAlertSenders, req.ip, FINDER_ALERT_SENDER_LIMIT);
    recordAttempt(finderAlertItems, String(lost.id), FINDER_ALERT_ITEM_LIMIT);
    await postgresStore.commitRequest();

    let emailSent = false;
    try {
      await sendMatchFinderNotificationEmail(owner, lost, notification);
      emailSent = true;
    } catch (error) {
      console.error(`Match finder alert email could not be sent to ${owner.email}:`, error.message);
    }
    if (owner.messengerPsid) {
      messenger
        .sendMessengerText(
          owner.messengerPsid,
          `Someone scanned the QR match reference for your lost report "${lost.title}" (${lost.refCode}) and says they found it. Sign in to Back2You and open your notifications (the bell icon) to see their message.`
        )
        .catch((error) => console.error('QR match-reference Messenger alert could not be sent:', error.message));
    }

    return res.json({
      success: true,
      emailSent,
      message: emailSent
        ? "Alert saved to the owner's inbox and sent by email."
        : "Alert saved to the owner's inbox, but email delivery is unavailable.",
      notification: publicFinderNotification(notification),
    });
  } catch (error) {
    console.error('Match finder alert failed:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to deliver the match alert.' });
  }
});

// GET /api/items/my-notifications - Retrieve notification inbox for logged-in user's registered items
router.get('/my-notifications', requireAuth, (req, res) => {
  const items = getItems();
  const userId = req.session.user.id;
  const userItems = items.filter((i) => String(i.reportedBy) === String(userId));
  const notifications = [];

  userItems.forEach((i) => {
    if (i.notifications && Array.isArray(i.notifications)) {
      i.notifications.forEach((n) => {
        notifications.push({
          ...publicFinderNotification(n),
          ...(n.conversation
            ? {
                notificationType: 'finder-conversation',
                conversationId: n.id,
                conversationStatus: n.conversation.status,
                conversationExpiresAt: n.conversation.expiresAt,
                lastMessage: n.conversation.messages?.[n.conversation.messages.length - 1]?.text || n.message,
              }
            : {}),
          itemId: i.id,
          itemTitle: i.title,
          refCode: i.refCode,
        });
      });
    }
  });

  const claims = getClaims();
  claims
    .filter((claim) => claim.claimantId === userId && claim.notification)
    .forEach((claim) => {
      notifications.push({
        ...claim.notification,
        notificationType: 'claim',
        claimId: claim.id,
        itemId: claim.itemId,
        itemTitle: claim.itemTitle,
        refCode: claim.itemRefCode,
      });
    });

  // Handover meetup (location sharing) for non-rejected claims this user is part of.
  const users = readJsonArray(USERS_FILE);
  let claimsChanged = false;
  claims.forEach((claim) => {
    if (pruneMeetup(claim)) claimsChanged = true;
    if (pruneClaimThread(claim)) claimsChanged = true;
    const conversationParties = claimConversationParties(claim, items, users);
    if (conversationParties) {
      const isOwner = String(conversationParties.owner.id) === String(userId);
      if (isOwner || String(conversationParties.finder.id) === String(userId)) {
        const deletedBy = Array.isArray(claim.conversationNotificationDeletedBy)
          ? claim.conversationNotificationDeletedBy
          : [];
        if (!deletedBy.includes(String(userId))) {
          const me = isOwner ? conversationParties.owner : conversationParties.finder;
          const other = isOwner ? conversationParties.finder : conversationParties.owner;
          notifications.push(claimConversationNotification(claim, conversationParties.item, me, other));
        }
      }
    }

    const parties = meetupParties(claim, items, users);
    if (!parties) return;
    const isOwner = String(parties.owner.id) === String(userId);
    if (!isOwner && String(parties.finder.id) !== String(userId)) return;
    const me = isOwner ? parties.owner : parties.finder;
    const other = isOwner ? parties.finder : parties.owner;
    notifications.push(meetupNotification(claim, parties.item, me, other, isOwner));
  });
  if (claimsChanged) saveClaims(claims);

  notifications.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  res.json({
    success: true,
    notifications,
    unreadCount: notifications.filter((n) => !n.read).length,
  });
});

// GET /api/items/match-reference-token - Create a short-lived verification link.
router.get('/match-reference-token', requireAuth, (req, res) => {
  const items = getItems();
  const first = items.find(
    (item) => String(item.id) === String(req.query.lostId) || String(item.id) === String(req.query.foundId)
  );
  const second = items.find(
    (item) =>
      String(item.id) !== String(first?.id) &&
      (String(item.id) === String(req.query.lostId) || String(item.id) === String(req.query.foundId))
  );
  const lost = [first, second].find((item) => item?.type === 'lost');
  const found = [first, second].find((item) => item?.type === 'found');
  if (!lost || !found) {
    return res.status(404).json({ success: false, message: 'The matched lost and found reports could not be found.' });
  }
  const isAdmin = req.session.user.role === 'admin';
  if (!isAdmin && !findMatches(lost, items).some((match) => String(match.id) === String(found.id))) {
    return res.status(403).json({ success: false, message: 'This report pair is not an available match reference.' });
  }

  const issuedAt = Date.now();
  const expiresAt = issuedAt + MATCH_REFERENCE_TTL_MS;
  const token = createMatchReferenceToken(lost.id, found.id, issuedAt);
  const referenceId = `MR-${issuedAt.toString(36).toUpperCase()}`;
  const claims = getClaims();
  const status = getMatchReferenceStatus(found, claims);
  const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
  const url = `${baseUrl.replace(/\/$/, '')}/match-reference?token=${encodeURIComponent(token)}`;
  if (!isAdmin) {
    const requesterRole = matchRequesterRole(lost, found, req.session.user.id);
    return res.json({
      success: true,
      view: 'status-only',
      token,
      url,
      referenceId,
      foundItemId: found.id,
      canRequestClaim: Boolean(requesterRole) && !found.claimed,
      requesterRole,
      claimId: findOwnClaimId(found, claims, lost.reportedBy),
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      status,
      lost: { id: lost.id, title: lost.title, refCode: lost.refCode },
      found: { id: found.id, title: found.title, refCode: found.refCode },
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
    found: { id: found.id, title: found.title, refCode: found.refCode },
  });
});

// GET /api/items/match-reference/:token - Resolve a QR link with role-appropriate detail.
router.get('/match-reference/:token', (req, res) => {
  const reference = parseMatchReferenceToken(req.params.token);
  if (!reference || reference.expiresAt <= Date.now()) {
    return res
      .status(410)
      .json({ success: false, message: 'This match reference has expired. Generate a new QR code.' });
  }

  const items = getItems();
  const lost = items.find((item) => String(item.id) === reference.lostId && item.type === 'lost');
  const found = items.find((item) => String(item.id) === reference.foundId && item.type === 'found');
  if (!lost || !found)
    return res.status(404).json({ success: false, message: 'Match reports are no longer available.' });

  const claims = getClaims();
  const status = getMatchReferenceStatus(found, claims);
  const referenceId = `MR-${reference.issuedAt.toString(36).toUpperCase()}`;
  if (!Array.isArray(found.matchScanLog)) found.matchScanLog = [];
  found.matchScanLog.unshift({
    scannedAt: new Date().toISOString(),
    scannerId: req.session?.user?.id || 'anonymous',
    scannerRole: req.session?.user?.role || 'anonymous',
  });
  found.matchScanLog = found.matchScanLog.slice(0, 100);
  saveItems(items);
  if (req.session?.user?.role !== 'admin') {
    const requesterRole = matchRequesterRole(lost, found, req.session?.user?.id);
    return res.json({
      success: true,
      view: 'status-only',
      foundItemId: found.id,
      issuedAt: new Date(reference.issuedAt).toISOString(),
      expiresAt: new Date(reference.expiresAt).toISOString(),
      referenceId,
      canRequestClaim: Boolean(requesterRole) && !found.claimed,
      requesterRole,
      claimId: findOwnClaimId(found, claims, lost.reportedBy),
      status,
      lost: { id: lost.id, title: lost.title, refCode: lost.refCode },
      found: { id: found.id, title: found.title, refCode: found.refCode },
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
    pendingClaims: claims.filter((claim) => String(claim.itemId) === String(found.id) && claim.status === 'pending')
      .length,
  });
});

// GET /api/items/:id/photo - Serve an uploaded item photo through the API origin.
// This avoids browser/proxy differences when loading the raw /uploads path.
router.get('/:id/photo', async (req, res) => {
  const item = getItems().find((entry) => String(entry.id) === String(req.params.id));
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

  // The item is all this needs from the database; unlock it before fetching the image
  // so a page full of photos does not queue every other request behind the downloads.
  try {
    await postgresStore.commitRequest();
  } catch (error) {
    return res.sendStatus(500);
  }

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

  res.sendFile(
    path.join(UPLOADS_DIR, filename),
    {
      headers: {
        'Cache-Control': 'public, max-age=86400',
      },
    },
    (error) => {
      if (error && !res.headersSent) res.sendStatus(error.code === 'ENOENT' ? 404 : 500);
    }
  );
});

// PATCH /api/items/notifications/read - Mark selected notifications as read
router.patch('/notifications/read', requireAuth, (req, res) => {
  const notificationIds = req.body?.notificationIds;
  if (
    !Array.isArray(notificationIds) ||
    notificationIds.length < 1 ||
    notificationIds.length > 1000 ||
    notificationIds.some(
      (reference) =>
        !reference ||
        typeof reference !== 'object' ||
        !['item', 'claim', 'claim-conversation'].includes(reference.kind) ||
        typeof reference.recordId !== 'string' ||
        !reference.recordId.trim() ||
        reference.recordId.length > 200 ||
        typeof reference.id !== 'string' ||
        !reference.id.trim() ||
        reference.id.length > 200
    )
  ) {
    return res.status(400).json({ success: false, message: 'Select between 1 and 1000 valid notifications.' });
  }

  const identities = new Set(
    notificationIds.map((reference) => `${reference.kind}:${reference.recordId}:${reference.id}`)
  );
  const userId = String(req.session.user.id);
  const items = getItems();
  const claims = getClaims();
  const users = readJsonArray(USERS_FILE);
  let itemsChanged = false;
  let claimsChanged = false;
  let updatedCount = 0;

  items.forEach((item) => {
    if (String(item.reportedBy) !== userId || !Array.isArray(item.notifications)) return;
    item.notifications.forEach((notification) => {
      if (
        identities.has(`item:${item.id}:${notification.id}`) &&
        !notification.read
      ) {
        notification.read = true;
        itemsChanged = true;
        updatedCount++;
      }
    });
  });

  claims.forEach((claim) => {
    if (
      String(claim.claimantId) === userId &&
      claim.notification &&
      identities.has(`claim:${claim.id}:${claim.notification.id}`) &&
      !claim.notification.read
    ) {
      claim.notification.read = true;
      claimsChanged = true;
      updatedCount++;
    }

    if (!identities.has(`claim-conversation:${claim.id}:claim-conversation-${claim.id}`)) return;
    const parties = claimConversationParties(claim, items, users);
    if (!parties) return;
    const isOwner = String(parties.owner.id) === userId;
    const isFinder = String(parties.finder.id) === userId;
    if (!isOwner && !isFinder) return;
    const me = isOwner ? parties.owner : parties.finder;
    const other = isOwner ? parties.finder : parties.owner;
    if (claimConversationNotification(claim, parties.item, me, other).read) return;

    claim.lastReadAt =
      claim.lastReadAt && typeof claim.lastReadAt === 'object' && !Array.isArray(claim.lastReadAt)
        ? claim.lastReadAt
        : {};
    claim.lastReadAt[userId] = new Date().toISOString();
    claimsChanged = true;
    updatedCount++;
  });

  if (itemsChanged) saveItems(items);
  if (claimsChanged) saveClaims(claims);
  res.json({ success: true, updatedCount });
});

router.delete('/notifications', requireAuth, (req, res) => {
  const notificationIds = req.body?.notificationIds;
  if (
    !Array.isArray(notificationIds) ||
    notificationIds.length < 1 ||
    notificationIds.length > 1000 ||
    notificationIds.some(
      (reference) =>
        !reference ||
        typeof reference !== 'object' ||
        !['item', 'claim', 'claim-conversation'].includes(reference.kind) ||
        typeof reference.recordId !== 'string' ||
        !reference.recordId.trim() ||
        reference.recordId.length > 200 ||
        typeof reference.id !== 'string' ||
        !reference.id.trim() ||
        reference.id.length > 200
    )
  ) {
    return res.status(400).json({ success: false, message: 'Select between 1 and 1000 valid notifications.' });
  }

  const identities = new Set(
    notificationIds.map((reference) => `${reference.kind}:${reference.recordId}:${reference.id}`)
  );
  const userId = String(req.session.user.id);
  const items = getItems();
  const claims = getClaims();
  const users = readJsonArray(USERS_FILE);
  let deletedCount = 0;

  items.forEach((item) => {
    if (String(item.reportedBy) !== userId || !Array.isArray(item.notifications)) return;
    const ownedNotifications = item.notifications.filter((notification) =>
      identities.has(`item:${item.id}:${notification.id}`)
    );
    deletedCount += ownedNotifications.length;
    item.notifications = item.notifications.filter(
      (notification) => !identities.has(`item:${item.id}:${notification.id}`)
    );
  });

  claims.forEach((claim) => {
    if (
      String(claim.claimantId) === userId &&
      claim.notification &&
      identities.has(`claim:${claim.id}:${claim.notification.id}`)
    ) {
      claim.notification = null;
      deletedCount += 1;
    }

    if (!identities.has(`claim-conversation:${claim.id}:claim-conversation-${claim.id}`)) return;
    const parties = claimConversationParties(claim, items, users);
    if (!parties || ![String(parties.owner.id), String(parties.finder.id)].includes(userId)) return;
    claim.conversationNotificationDeletedBy = Array.isArray(claim.conversationNotificationDeletedBy)
      ? claim.conversationNotificationDeletedBy
      : [];
    if (claim.conversationNotificationDeletedBy.includes(userId)) return;
    claim.conversationNotificationDeletedBy.push(userId);
    deletedCount += 1;
  });

  if (deletedCount) {
    saveItems(items);
    saveClaims(claims);
  }

  res.json({ success: true, deletedCount });
});

// PATCH /api/items/notifications/:notifId/read - Mark one notification as read
router.patch('/notifications/:notifId/read', requireAuth, (req, res) => {
  const items = getItems();
  const userId = req.session.user.id;
  const notifId = req.params.notifId;
  let found = false;

  items.forEach((i) => {
    if (i.reportedBy === userId && i.notifications) {
      const targetNotif = i.notifications.find((n) => n.id === notifId);
      if (targetNotif) {
        targetNotif.read = true;
        found = true;
      }
    }
  });

  const claims = getClaims();
  claims.forEach((claim) => {
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
  const item = items.find((i) => String(i.id) === String(req.params.id));
  const user = req.session?.user;
  const canViewPrivateFields = user && (user.role === 'admin' || (item && String(item.reportedBy) === String(user.id)));
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
      potentialMatch: match ? { id: match.id, title: match.title, location: match.location, type: match.type } : null,
    },
  });
});

// Either the lost item's owner or the found item's finder can start this
// conversation - whichever one of them didn't start it is still always the
// "claimant" (claimantId, claimantName, etc. always describe the owner, since
// that's who meetup/confirm/email logic elsewhere keys off of).
router.post('/:id/claim-requests', requireAuth, async (req, res) => {
  const proof = sanitizeString(req.body.proof || '');
  if (proof.length < 5 || proof.length > 500) {
    return res
      .status(400)
      .json({ success: false, message: 'Describe the item or an identifying detail, between 5 and 500 characters.' });
  }
  const courseYear = sanitizeString(req.body.courseYear || '');
  const contactNumber = sanitizeString(req.body.contactNumber || '');
  if (courseYear.length > 100 || contactNumber.length > 50) {
    return res.status(400).json({ success: false, message: 'Claimant contact details exceed the allowed length.' });
  }

  const items = getItems();
  const item = items.find((entry) => String(entry.id) === String(req.params.id));
  if (!item || item.type !== 'found' || item.claimed) {
    return res.status(404).json({ success: false, message: 'Found item is no longer available for a claim.' });
  }

  const lostItem = items.find((entry) => String(entry.id) === String(req.body.lostId) && entry.type === 'lost');
  const isPotentialMatch =
    lostItem && findMatches(lostItem, items).some((match) => String(match.id) === String(item.id));
  const userId = String(req.session.user.id);
  const isOwner = lostItem && String(lostItem.reportedBy) === userId;
  const isFinder = String(item.reportedBy) === userId;
  if (isOwner && isFinder) {
    return res.status(403).json({ success: false, message: 'You cannot start a conversation with yourself.' });
  }
  if (!isPotentialMatch || (!isOwner && !isFinder)) {
    return res.status(403).json({
      success: false,
      message: "Only the lost item's owner or the found item's finder can start this conversation.",
    });
  }

  const claimant = isOwner
    ? req.session.user
    : readJsonArray(USERS_FILE).find((user) => String(user.id) === String(lostItem.reportedBy));
  if (!claimant) {
    return res.status(404).json({ success: false, message: "The lost item's owner account could not be found." });
  }
  // The body's courseYear/contactNumber are only ever honored when the claimant is
  // submitting for themselves - letting the finder set the owner's contact details
  // through the conversation's starter message would let them spoof that data.
  const claimantContact = isOwner
    ? contactNumber || claimant.phone || claimant.contactNumber || ''
    : claimant.phone || claimant.contactNumber || '';
  const claimantCourseYear = isOwner
    ? courseYear || claimant.courseYear || claimant.yearLevel || ''
    : claimant.courseYear || claimant.yearLevel || '';

  const claims = getClaims();
  const duplicate = claims.some(
    (claim) =>
      String(claim.itemId) === String(item.id) &&
      String(claim.claimantId) === String(claimant.id) &&
      claim.status === 'pending'
  );
  if (duplicate) {
    return res
      .status(409)
      .json({ success: false, message: 'There is already a pending claim conversation for this item.' });
  }

  const claim = {
    id: `claim-${crypto.randomUUID()}`,
    itemId: item.id,
    itemTitle: item.title,
    itemRefCode: item.refCode,
    lostItemId: lostItem.id,
    lostItemTitle: lostItem.title,
    lostItemRefCode: lostItem.refCode,
    claimantId: claimant.id,
    claimantName: claimant.fullName,
    claimantEmail: claimant.email,
    claimantContact,
    claimantStudentId: claimant.studentId || '',
    claimantCourseYear,
    claimantDepartment: claimant.department || '',
    proof,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  // The proof doubles as the opening message of the claim conversation, so
  // whoever started it sees what they just sent rather than an empty thread.
  claim.messages = [
    { id: `msg-${crypto.randomUUID()}`, senderId: req.session.user.id, text: proof, createdAt: claim.createdAt },
  ];
  claims.unshift(claim);
  saveClaims(claims);
  await postgresStore.commitRequest();

  const users = readJsonArray(USERS_FILE);
  const recipients = users.filter(
    (user) =>
      user.email &&
      (user.role === 'admin' ||
        String(user.id) === String(item.reportedBy) ||
        String(user.id) === String(claim.claimantId))
  );
  for (const recipient of recipients) {
    try {
      await sendClaimRequestEmail(recipient, item, claim, 'submitted');
    } catch (error) {
      console.error('Claim request email could not be sent:', error.message);
    }
  }

  res.status(201).json({
    success: true,
    message: isOwner
      ? 'Claim request submitted. Open the conversation to talk with the finder.'
      : 'Message sent. Open the conversation to talk with the owner.',
    claim: { id: claim.id, status: claim.status },
  });
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
    const submissionFingerprint = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          title,
          category,
          type,
          location,
          locationDetails,
          contact,
          desc,
          verification,
          photo: req.file ? crypto.createHash('sha256').update(req.file.buffer).digest('hex') : '',
        })
      )
      .digest('hex');

    if (submissionKey) {
      const previousSubmission = items.find((item) => item.submissionKey === submissionKey);
      if (previousSubmission) {
        if (String(previousSubmission.reportedBy) !== String(reporterId)) {
          return res.status(409).json({ success: false, message: 'This submission key is already in use.' });
        }
        if (previousSubmission.submissionFingerprint !== submissionFingerprint) {
          return res
            .status(409)
            .json({ success: false, message: 'This submission key was already used for a different report.' });
        }

        const responseItem = { ...previousSubmission };
        delete responseItem.submissionKey;
        delete responseItem.submissionFingerprint;
        return res.json({
          success: true,
          duplicate: true,
          message: `This report was already received with Reference Code: ${previousSubmission.refCode}`,
          item: responseItem,
          potentialMatch: null,
        });
      }
    }

    const reporterKey = req.session?.user ? `account:${reporterId}` : `network:${req.ip}`;
    const reportLimit = req.session?.user ? ACCOUNT_REPORT_LIMIT : GUEST_REPORT_LIMIT;
    if (isRateLimited(reportAttempts, reporterKey, reportLimit)) {
      return res
        .status(429)
        .json({ success: false, message: 'Too many reports were submitted in the last hour. Please try again later.' });
    }

    if (req.file) {
      const moderation = await imageModeration.moderateImage(req.file);
      if (!moderation.allowed) {
        return res.status(422).json({
          success: false,
          message: `This photo could not be used${moderation.reason ? `: ${moderation.reason}` : '.'} Please choose another photo, or submit the report without one.`,
        });
      }
    }

    const refCode = newRefCode(items, `CSPC-LF-${currentYear()}`, 5);
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
      createdAt: new Date().toISOString(),
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
    recordAttempt(reportAttempts, reporterKey, reportLimit);
    await postgresStore.commitRequest();

    for (const { student, lostItem, foundItem } of emailNotifications) {
      try {
        await sendPossibleMatchEmail(student, lostItem, foundItem);
      } catch (error) {
        console.error('Possible-match notification email could not be sent:', error.message);
      }
      if (student.messengerPsid) {
        messenger
          .sendMessengerText(
            student.messengerPsid,
            `A found item may match your lost-item report "${lostItem.title}". Sign in to Back2You to review the possible match (${foundItem.title}, ${foundItem.refCode}).`
          )
          .catch((error) => console.error('Possible-match Messenger alert could not be sent:', error.message));
      }
    }

    const responseItem = { ...newItem };
    delete responseItem.submissionKey;
    delete responseItem.submissionFingerprint;
    res.status(201).json({
      success: true,
      message: `Item successfully reported with Reference Code: ${refCode}`,
      item: responseItem,
      potentialMatch: match ? { id: match.id, title: match.title, location: match.location, type: match.type } : null,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to record item report.' });
  }
});

// GET /api/items/:id/activity - Read the audit trail for an item.
router.get('/:id/activity', requireRole('admin'), (req, res) => {
  const item = getItems().find((entry) => String(entry.id) === String(req.params.id));
  if (!item) return res.status(404).json({ success: false, message: 'Item not found.' });
  res.json({ success: true, activity: Array.isArray(item.activityLog) ? item.activityLog : [] });
});

// POST /api/items/:id/activity - Add an admin note to an item audit trail.
router.post('/:id/activity', requireRole('admin'), (req, res) => {
  const items = getItems();
  const item = items.find((entry) => String(entry.id) === String(req.params.id));
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
  if (!ids.length || ids.length > 100)
    return res.status(400).json({ success: false, message: 'Select between 1 and 100 items.' });
  if (!['claim', 'delete', 'archive', 'status'].includes(action))
    return res.status(400).json({ success: false, message: 'Unsupported bulk action.' });
  const status = action === 'status' ? sanitizeString(req.body.status || '') : action === 'archive' ? 'archived' : '';
  if (action === 'status' && !['active', 'claimed', 'archived'].includes(status))
    return res.status(400).json({ success: false, message: 'Invalid bulk status.' });

  let items = getItems();
  const selected = items.filter((item) => ids.includes(String(item.id)));
  if (!selected.length) return res.status(404).json({ success: false, message: 'No selected items were found.' });
  if (action === 'claim' || action === 'archive' || action === 'status') {
    selected.forEach((item) => {
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
    selected.forEach((item) => addItemActivity(item, req, 'Deleted', 'Bulk admin action.'));
    items = items.filter((item) => !ids.includes(String(item.id)));
    saveItems(items);
    saveClaims(getClaims().filter((claim) => !ids.includes(String(claim.itemId))));
  }
  res.json({ success: true, affected: selected.length, action });
});

// PATCH /api/items/:id/status - Update active, claimed, or archived status.
router.patch('/:id/status', requireRole('admin'), (req, res) => {
  const status = sanitizeString(req.body.status || '');
  if (!['active', 'claimed', 'archived'].includes(status))
    return res.status(400).json({ success: false, message: 'Invalid item status.' });
  const items = getItems();
  const item = items.find((entry) => String(entry.id) === String(req.params.id));
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
  const itemIndex = items.findIndex((i) => String(i.id) === String(req.params.id));
  if (itemIndex === -1) {
    return res.status(404).json({ success: false, message: 'Item not found.' });
  }

  const item = items[itemIndex];
  const canResolve = req.session.user.role === 'admin' || String(item.reportedBy) === String(req.session.user.id);
  if (!canResolve) {
    return res
      .status(403)
      .json({ success: false, message: 'Only the original reporter or an administrator can resolve this item.' });
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
  await postgresStore.commitRequest();
  if (item.reporterEmail) {
    try {
      await sendClaimStatusEmail(
        { fullName: item.reporterName, email: item.reporterEmail },
        item,
        { claimantName: item.reporterName, claimantEmail: item.reporterEmail },
        'approved'
      );
    } catch (error) {
      console.error('Claim notification email could not be sent:', error.message);
    }
  }
  res.json({
    success: true,
    message: `Item ${item.refCode} marked as claimed.`,
    item,
  });
});

// PATCH /api/items/:id/registered - Update a student's registered belonging.
router.patch('/:id/registered', requireAuth, (req, res) => {
  const items = getItems();
  const item = items.find((entry) => String(entry.id) === String(req.params.id));
  if (!item || item.type !== 'registered')
    return res.status(404).json({ success: false, message: 'Registered belonging not found.' });
  const isOwner = String(item.reportedBy) === String(req.session.user.id);
  if (req.session.user.role !== 'admin' && !isOwner)
    return res.status(403).json({ success: false, message: 'You can only edit your own registered belongings.' });

  const { title, category, location, identifiers, instructions } = req.body;
  const cleanTitle = sanitizeString(title || '');
  const cleanCategory = sanitizeString(category || '');
  if (cleanTitle.length < 3 || cleanTitle.length > 100 || !cleanCategory) {
    return res.status(400).json({ success: false, message: 'A valid title and category are required.' });
  }
  item.title = cleanTitle;
  item.category = cleanCategory;
  item.location = sanitizeString(location || 'Campus-wide');
  item.locationDetails = sanitizeString(identifiers || '');
  item.verification = item.locationDetails || 'Registered by verified CSPC account';
  item.desc = item.locationDetails
    ? `Valuable belonging: ${item.locationDetails}`
    : 'Valuable personal belonging registered in student vault.';
  item.instructions = sanitizeString(instructions || '');
  item.updatedAt = new Date().toISOString();
  saveItems(items);
  res.json({ success: true, message: 'Belonging details updated.', item });
});

// DELETE /api/items/:id - Remove item (owner of a registered belonging or admin)
router.delete('/:id', requireAuth, async (req, res) => {
  let items = getItems();
  const item = items.find((i) => String(i.id) === String(req.params.id));
  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found.' });
  }
  const isAdmin = req.session.user.role === 'admin';
  const isOwner = String(item.reportedBy) === String(req.session.user.id);
  if (!isAdmin && !isOwner)
    return res.status(403).json({ success: false, message: 'You do not have permission to delete this item.' });

  // A student can't delete their own registered belonging while an unread finder
  // alert is waiting on it - that alert lives only on this item record, so deleting
  // it now would erase someone's "I found this" message before the owner ever saw
  // it. Lost/found reports can be deleted by their reporter regardless of status
  // (including already claimed) - admins can always delete regardless either way.
  if (
    !isAdmin &&
    item.type === 'registered' &&
    Array.isArray(item.notifications) &&
    item.notifications.some((n) => !n.read)
  ) {
    return res.status(409).json({
      success: false,
      message: 'Someone reported finding this item. Please review that notification before deleting it.',
    });
  }

  items = items.filter((i) => String(i.id) !== String(req.params.id));
  saveItems(items);
  if (typeof item.photo === 'string' && item.photo.startsWith('/uploads/')) {
    fs.rmSync(path.join(UPLOADS_DIR, path.basename(item.photo)), { force: true });
  }
  if (supabaseStorage.objectKey(item.photo)) await supabaseStorage.deleteImage(item.photo);
  saveClaims(getClaims().filter((claim) => String(claim.itemId) !== String(item.id)));

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

    const refCode = newRefCode(items, 'CSPC-REG-QR', 6);
    const user = req.session.user;

    const newBelonging = {
      id: Date.now(),
      refCode,
      title: sanitizeString(title),
      category: sanitizeString(category),
      type: 'registered', // Preventive personal belonging
      location: sanitizeString(location || 'Campus-wide'),
      locationDetails: sanitizeString(identifiers || ''),
      instructions: sanitizeString(instructions || ''),
      contact: `${user.fullName} (${user.studentId || user.email})`,
      desc: identifiers
        ? `Valuable belonging: ${sanitizeString(identifiers)}`
        : 'Valuable personal belonging registered in student vault.',
      verification: identifiers || 'Registered by verified CSPC account',
      photo: '',
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      status: 'registered',
      claimed: false,
      reportedBy: user.id,
      ownerName: user.fullName,
      ownerEmail: user.email,
      notifications: [],
      createdAt: new Date().toISOString(),
    };

    items.unshift(newBelonging);
    saveItems(items);

    res.status(201).json({
      success: true,
      message: 'Belonging successfully registered in your private vault!',
      item: newBelonging,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to register belonging.' });
  }
});

module.exports = router;
