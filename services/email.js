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

async function sendRegistrationEmail(user) {
  const transport = createTransport();
  const name = user.fullName || 'there';
  const safeName = escapeHtml(name);

  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to: user.email,
    subject: 'Your Back2You account was created',
    text: `Hi ${name},\n\nYour Back2You account has been created successfully using ${user.email}.\n\nYou can now sign in to Back2You to report or find campus items.\n\nThe Back2You Team`,
    html: `<p>Hi ${safeName},</p><p>Your Back2You account has been created successfully using <strong>${escapeHtml(user.email)}</strong>.</p><p>You can now sign in to Back2You to report or find campus items.</p><p>The Back2You Team</p>`
  });
}

async function sendPossibleMatchEmail(user, foundRefCode, foundItemId) {
  const appBaseUrl = process.env.APP_BASE_URL;
  if (!appBaseUrl) {
    throw new Error('APP_BASE_URL must be configured to send possible-match emails.');
  }

  const parsedBaseUrl = new URL(appBaseUrl);
  if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)) {
    throw new Error('APP_BASE_URL must use HTTP or HTTPS.');
  }
  const matchUrl = new URL('/', parsedBaseUrl);
  matchUrl.searchParams.set('search', foundRefCode);
  matchUrl.searchParams.set('matchItemId', String(foundItemId));
  matchUrl.hash = 'items';
  const reviewUrl = new URL('/login', parsedBaseUrl);
  reviewUrl.searchParams.set('redirect', `${matchUrl.pathname}${matchUrl.search}${matchUrl.hash}`);

  const transport = createTransport();
  const name = user.fullName || 'there';
  const safeName = escapeHtml(name);
  const link = reviewUrl.toString();
  const message = 'A found item may match a lost-item report associated with your account. Sign in to review the possible match and verify ownership with campus staff. An automated match is not confirmation of ownership.';

  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to: user.email,
    subject: 'Possible match for your Back2You lost-item report',
    text: `Hi ${name},\n\n${message}\n\nReview the possible match: ${link}\n\nThe Back2You Team`,
    html: `<p>Hi ${safeName},</p><p>${escapeHtml(message)}</p><p><a href="${escapeHtml(link)}">Review possible match</a></p><p>An automated match is not confirmation of ownership. Please verify ownership with campus staff before any handover.</p><p>The Back2You Team</p>`
  });
}

module.exports = { sendRegistrationEmail, sendPossibleMatchEmail };
