const nodemailer = require('nodemailer');

function createTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !process.env.SMTP_FROM) {
    throw new Error('SMTP_HOST and SMTP_FROM must be configured.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT must be a valid TCP port.');
  }
  if (Boolean(user) !== Boolean(pass)) {
    throw new Error('SMTP_USER and SMTP_PASS must both be configured, or both omitted.');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE
      ? process.env.SMTP_SECURE.toLowerCase() === 'true'
      : port === 465,
    ...(user ? { auth: { user, pass } } : {}),
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function getAppUrl(pathname) {
  const appBaseUrl = process.env.APP_BASE_URL;
  if (!appBaseUrl) {
    throw new Error('APP_BASE_URL must be configured to send account emails.');
  }

  const parsedBaseUrl = new URL(appBaseUrl);
  if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)) {
    throw new Error('APP_BASE_URL must use HTTP or HTTPS.');
  }

  return new URL(pathname, parsedBaseUrl).toString();
}

async function sendRegistrationEmail(user) {
  const transport = createTransport();
  const name = user.fullName || 'there';
  const safeName = escapeHtml(name);
  const signInUrl = getAppUrl('/login');

  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to: user.email,
    subject: 'Welcome to Back2You — your account is ready',
    text: `Hi ${name},\n\nWelcome to Back2You! Your account has been created successfully.\n\nYou can now sign in to report a lost item, report an item you found, and receive alerts if a found item may match your lost-item report. You can also register personal belongings to create QR recovery stickers.\n\nA possible match is only a suggestion—not confirmation of ownership. Please verify your item with campus staff before arranging a handover.\n\nSign in to Back2You: ${signInUrl}\n\nWe hope Back2You helps reunite you with your belongings.\n\nBest,\nThe Back2You Team`,
    html: `<p>Hi ${safeName},</p><p>Welcome to Back2You! Your account has been created successfully.</p><p>You can now sign in to report a lost item, report an item you found, and receive alerts if a found item may match your lost-item report. You can also register personal belongings to create QR recovery stickers.</p><p>A possible match is only a suggestion—not confirmation of ownership. Please verify your item with campus staff before arranging a handover.</p><p><a href="${escapeHtml(signInUrl)}">Sign in to Back2You</a></p><p>We hope Back2You helps reunite you with your belongings.</p><p>Best,<br>The Back2You Team</p>`
  });
}

async function sendPossibleMatchEmail(user, lostItem, foundItem) {
  const matchUrl = new URL(getAppUrl('/'));
  matchUrl.searchParams.set('search', foundItem.refCode);
  matchUrl.searchParams.set('matchItemId', String(foundItem.id));
  matchUrl.hash = 'items';
  const reviewUrl = new URL(getAppUrl('/login'));
  reviewUrl.searchParams.set('redirect', `${matchUrl.pathname}${matchUrl.search}${matchUrl.hash}`);

  const transport = createTransport();
  const name = user.fullName || 'there';
  const safeName = escapeHtml(name);
  const link = reviewUrl.toString();
  const instructions = 'Sign in to Back2You to review the possible match. If you believe the found item is yours, contact the Student Affairs and Services (SAS) office or the General Services Unit / Campus Security Desk. Bring your student ID and both report reference codes. Campus staff will verify ownership before any item is returned; this automated match is not confirmation of ownership.';
  const lostDetails = `Lost report: ${lostItem.title} (${lostItem.refCode})`;
  const foundDetails = `Found report: ${foundItem.title} (${foundItem.refCode}) at ${foundItem.location}`;

  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to: user.email,
    subject: 'Possible match for your Back2You lost-item report',
    text: `Hi ${name},\n\nA found item may match your lost-item report. This is only a possible match, not confirmation of ownership.\n\n${lostDetails}\n${foundDetails}\n\n${instructions}\n\nReview the possible match: ${link}\n\nThe Back2You Team`,
    html: `<p>Hi ${safeName},</p><p>A found item may match your lost-item report. This is only a possible match, not confirmation of ownership.</p><ul><li>${escapeHtml(lostDetails)}</li><li>${escapeHtml(foundDetails)}</li></ul><p>${escapeHtml(instructions)}</p><p><a href="${escapeHtml(link)}">Review the possible match</a></p><p>The Back2You Team</p>`
  });
}

module.exports = { sendRegistrationEmail, sendPossibleMatchEmail };
