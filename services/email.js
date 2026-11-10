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

// One-time 6-digit code: confirms a new account's inbox ('signup') or completes a
// sign-in ('login'). The code is only valid in the browser that asked for it.
async function sendVerificationCodeEmail(user, code, purpose, minutesValid) {
  const transport = createTransport();
  const name = user.fullName || 'Student';
  const isSignup = purpose === 'signup';

  // Paragraphs shared by the text and HTML versions; the code sits after `before`.
  const before = isSignup
    ? [
      'Thank you for registering with Back2You, the official Lost & Found system of Camarines Sur Polytechnic Colleges.',
      'To complete your registration, please verify your CSPC email address by entering the one-time password (OTP) below on the verification screen:'
    ]
    : [
      'A sign-in to your Back2You account was requested.',
      'To complete the sign-in, please enter the one-time password (OTP) below on the verification screen:'
    ];
  const after = [
    `This code will expire in ${minutesValid} ${minutesValid === 1 ? 'minute' : 'minutes'} and can be used only once, in the browser where it was requested. For your security, do not share this code with anyone, including Back2You staff.`,
    ...(isSignup
      ? [
        'Once your email address is verified, you will be able to report lost items, report items you have found, and receive alerts when a found item may match your lost-item report. You may also register personal belongings to generate QR recovery stickers.',
        'If you did not create a Back2You account, please disregard this email. No account will be activated without this code.'
      ]
      : ['If you did not attempt to sign in, please disregard this email and change your password as soon as possible, as someone may know it.'])
  ];

  const paragraph = text => `<p style="margin:0 0 14px;line-height:1.6">${escapeHtml(text)}</p>`;
  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to: user.email,
    subject: isSignup
      ? `Back2You Email Verification Code: ${code}`
      : `Back2You Sign-in Verification Code: ${code}`,
    text: [
      `Dear ${name},`,
      ...before,
      `Your verification code: ${code}`,
      ...after,
      'Sincerely,\nThe Back2You Team\nCamarines Sur Polytechnic Colleges'
    ].join('\n\n'),
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937">
      ${paragraph(`Dear ${name},`)}
      ${before.map(paragraph).join('')}
      <p style="margin:6px 0 4px;color:#4b5563;font-size:13px;text-align:center">Your verification code</p>
      <p style="margin:0 0 20px;padding:14px 0;border:1px solid #bfdbfe;border-radius:12px;background:#eff6ff;color:#1d4ed8;font-family:Consolas,'Courier New',monospace;font-size:32px;font-weight:700;letter-spacing:10px;text-align:center">${escapeHtml(code)}</p>
      ${after.map(paragraph).join('')}
      <p style="margin:18px 0 0;line-height:1.6">Sincerely,<br>The Back2You Team<br><span style="color:#6b7280">Camarines Sur Polytechnic Colleges</span></p>
    </div>`
  });
}

async function sendPasswordResetEmail(user, token) {
  const transport = createTransport();
  const name = user.fullName || 'there';
  const resetUrl = new URL(getAppUrl('/login'));
  resetUrl.searchParams.set('reset', token);
  const link = resetUrl.toString();

  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to: user.email,
    subject: 'Reset your Back2You password',
    text: `Hi ${name},\n\nWe received a request to reset your Back2You password. Open this link to choose a new password:\n\n${link}\n\nThis link expires in 1 hour and can only be used once.\n\nIf you did not request this, you can ignore this email. Your password will not change.\n\nBack2You – CSPC Lost & Found`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>We received a request to reset your Back2You password. Open this link to choose a new password:</p><p><a href="${escapeHtml(link)}">Reset my password</a></p><p>This link expires in 1 hour and can only be used once.</p><p>If you did not request this, you can ignore this email. Your password will not change.</p><p>Back2You – CSPC Lost &amp; Found</p>`
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
  const lostDetails = `Your lost-item report: ${lostItem.title} (${lostItem.refCode})`;
  const foundDetails = `Possible found-item match: ${foundItem.title} (${foundItem.refCode})`;

  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to: user.email,
    subject: 'Possible match for your Back2You lost-item report',
    text: `Hi ${name},\n\nA found item may match your lost-item report. This is only a possible match and does not confirm ownership. Sign in to Back2You to review the details.\n\n- ${lostDetails}\n- ${foundDetails}\n- Reported location: ${foundItem.location}\n\nIf you believe this is your item, be prepared to provide information that helps verify your ownership. The item will only be returned after ownership has been verified.\n\nReview the possible match: ${link}\n\nThank you,\nBack2You – CSPC Lost & Found`,
    html: `<p>Hi ${safeName},</p><p>A found item may match your lost-item report. This is only a possible match and does not confirm ownership. Sign in to Back2You to review the details.</p><ul><li>${escapeHtml(lostDetails)}</li><li>${escapeHtml(foundDetails)}</li><li>Reported location: ${escapeHtml(foundItem.location)}</li></ul><p>If you believe this is your item, be prepared to provide information that helps verify your ownership. The item will only be returned after ownership has been verified.</p><p><a href="${escapeHtml(link)}">Review the possible match</a></p><p>Thank you,<br>Back2You – CSPC Lost &amp; Found</p>`
  });
}

async function sendClaimStatusEmail(user, item, claim, status) {
  const transport = createTransport();
  const name = user.fullName || claim.claimantName || 'there';
  const message = status === 'approved'
    ? `Your claim for ${item.title} (${item.refCode}) was approved. Please follow the campus handover instructions provided by Back2You.`
    : `Your claim for ${item.title} (${item.refCode}) was not approved. ${claim.rejectionReason || 'Please contact campus staff if you need clarification.'}`;
  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to: user.email || claim.claimantEmail,
    subject: `Back2You claim ${status}: ${item.title}`,
    text: `Hi ${name},\n\n${message}\n\nBack2You – CSPC Lost & Found`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>${escapeHtml(message)}</p><p>Back2You – CSPC Lost &amp; Found</p>`
  });
}

async function sendClaimRequestEmail(user, item, claim, event = 'submitted') {
  const transport = createTransport();
  const name = user.fullName || claim.claimantName || 'there';
  const eventText = event === 'submitted'
    ? `A claim request was submitted for ${item.title} (${item.refCode}). Ownership proof has been sent for moderator review.`
    : event === 'approved'
      ? `The claim request for ${item.title} (${item.refCode}) was approved.`
      : `The claim request for ${item.title} (${item.refCode}) was rejected. ${claim.rejectionReason || 'Please contact campus staff for clarification.'}`;
  const signInUrl = getAppUrl('/login');
  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to: user.email,
    subject: `Back2You claim request ${event}: ${item.title}`,
    text: `Hi ${name},\n\n${eventText}\n\nReview Back2You: ${signInUrl}\n\nBack2You – CSPC Lost & Found`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>${escapeHtml(eventText)}</p><p><a href="${escapeHtml(signInUrl)}">Open Back2You</a></p><p>Back2You – CSPC Lost &amp; Found</p>`
  });
}

async function sendFinderNotificationEmail(user, item, notification) {
  const transport = createTransport();
  const name = user.fullName || 'there';
  const safeName = escapeHtml(name);
  const signInUrl = getAppUrl('/login');
  const finderContact = notification.finderContact === 'Anonymous Student / Finder'
    ? 'The finder chose to remain anonymous.'
    : `Optional finder contact: ${notification.finderContact}`;
  const subject = `Finder alert for your registered item: ${item.title}`;
  const text = `Hi ${name},\n\nSomeone scanned the recovery QR code for your registered item and reported finding it.\n\nItem: ${item.title} (${item.refCode})\nLocation found: ${notification.locationFound}\nFinder's message: ${notification.message}\n${finderContact}\n\nSign in to Back2You to view the alert: ${signInUrl}\n\nBack2You – CSPC Lost & Found`;
  const html = `<p>Hi ${safeName},</p><p>Someone scanned the recovery QR code for your registered item and reported finding it.</p><ul><li><strong>Item:</strong> ${escapeHtml(item.title)} (${escapeHtml(item.refCode)})</li><li><strong>Location found:</strong> ${escapeHtml(notification.locationFound)}</li><li><strong>Finder's message:</strong> ${escapeHtml(notification.message)}</li><li>${escapeHtml(finderContact)}</li></ul><p><a href="${escapeHtml(signInUrl)}">Sign in to Back2You to view the alert</a></p><p>Back2You – CSPC Lost &amp; Found</p>`;

  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to: user.email,
    subject,
    text,
    html
  });
}

async function sendMatchFinderNotificationEmail(user, item, notification) {
  const transport = createTransport();
  const name = user.fullName || 'there';
  const safeName = escapeHtml(name);
  const signInUrl = getAppUrl('/login');
  const finderContact = notification.finderContact === 'Anonymous Student / Finder'
    ? 'The finder chose to remain anonymous.'
    : `Optional finder contact: ${notification.finderContact}`;
  const subject = `Finder alert for your possible match: ${item.title}`;
  const text = `Hi ${name},\n\nSomeone submitted a recovery alert for an item that may match your lost-item report.\n\n- Item: ${item.title} (${item.refCode})\n- Location found: ${notification.locationFound}\n- Finder's message: ${notification.message}\n- ${finderContact}\n\nSign in to Back2You to view the alert: ${signInUrl}\n\nBack2You – CSPC Lost & Found`;
  const html = `<p>Hi ${safeName},</p><p>Someone submitted a recovery alert for an item that may match your lost-item report.</p><ul><li><strong>Item:</strong> ${escapeHtml(item.title)} (${escapeHtml(item.refCode)})</li><li><strong>Location found:</strong> ${escapeHtml(notification.locationFound)}</li><li><strong>Finder's message:</strong> ${escapeHtml(notification.message)}</li><li>${escapeHtml(finderContact)}</li></ul><p><a href="${escapeHtml(signInUrl)}">Sign in to Back2You to view the alert</a></p><p>Back2You – CSPC Lost &amp; Found</p>`;
  const info = await transport.sendMail({ from: process.env.SMTP_FROM, to: user.email, subject, text, html });
  if (info.rejected && info.rejected.length) throw new Error(`SMTP rejected recipient(s): ${info.rejected.join(', ')}`);
  console.log(`Match finder alert email accepted for ${user.email} (messageId=${info.messageId || 'unknown'})`);
  return info;
}

async function sendBroadcastEmail(user, subject, message) {
  const transport = createTransport();
  const name = user.fullName || 'there';
  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to: user.email,
    subject,
    text: `Hi ${name},\n\n${message}\n\nBack2You – CSPC Lost & Found`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>${escapeHtml(message).replace(/\n/g, '<br>')}</p><p>Back2You – CSPC Lost &amp; Found</p>`
  });
}

module.exports = {
  sendVerificationCodeEmail,
  sendPasswordResetEmail,
  sendPossibleMatchEmail,
  sendClaimStatusEmail,
  sendClaimRequestEmail,
  sendFinderNotificationEmail,
  sendMatchFinderNotificationEmail,
  sendBroadcastEmail
};
