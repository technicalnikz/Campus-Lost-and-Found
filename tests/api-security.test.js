const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');
const test = require('node:test');
const bcrypt = require('bcryptjs');

let dataDir;
let appServer;
let baseUrl;
let createApp;

const adminPassword = 'AdminPass1!';
const studentPassword = 'StudentPass1!';
const smtpEnvironmentKeys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'APP_BASE_URL'];
const originalSmtpEnvironment = Object.fromEntries(
  smtpEnvironmentKeys.map(key => [key, process.env[key]])
);

function fixtureUser(id, email, password, role) {
  return {
    id,
    email,
    passwordHash: bcrypt.hashSync(password, 4),
    fullName: role === 'admin' ? 'CSPC Admin' : 'Test Student',
    studentId: role === 'admin' ? 'N/A' : '2026001',
    role,
    department: 'CCS',
    createdAt: new Date().toISOString()
  };
}

async function login(email, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const sessionResponse = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal((await sessionResponse.json()).authenticated, true);
  return cookie;
}

function reportFormData(photo, overrides = {}) {
  const form = new FormData();
  const fields = {
    title: 'Test umbrella',
    category: 'Others',
    type: 'lost',
    location: 'Main Building',
    contact: 'test@example.edu',
    desc: 'Black umbrella with a wooden handle.',
    verification: 'Private mark on the handle',
    ...overrides
  };
  Object.entries(fields).forEach(([key, value]) => form.set(key, value));
  if (photo) form.set('photo', photo, 'test-image.png');
  return form;
}

async function startSmtpCaptureServer() {
  const messages = [];
  let recipient;
  const server = net.createServer(socket => {
    let input = '';
    let dataLines = [];
    let inData = false;
    socket.write('220 localhost ESMTP\r\n');

    socket.on('data', chunk => {
      input += chunk.toString();
      let lineEnd = input.indexOf('\r\n');
      while (lineEnd !== -1) {
        const line = input.slice(0, lineEnd);
        input = input.slice(lineEnd + 2);

        if (inData) {
          if (line === '.') {
            inData = false;
            messages.push({ recipient, content: dataLines.join('\r\n') });
            dataLines = [];
            socket.write('250 Message accepted\r\n');
          } else {
            dataLines.push(line.startsWith('..') ? line.slice(1) : line);
          }
        } else if (/^EHLO /i.test(line) || /^HELO /i.test(line)) {
          socket.write('250 localhost\r\n');
        } else if (/^MAIL FROM:/i.test(line)) {
          socket.write('250 Sender accepted\r\n');
        } else if (/^RCPT TO:/i.test(line)) {
          recipient = line;
          socket.write('250 Recipient accepted\r\n');
        } else if (/^DATA$/i.test(line)) {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (/^QUIT$/i.test(line)) {
          socket.write('221 Bye\r\n');
        } else {
          socket.write('250 OK\r\n');
        }

        lineEnd = input.indexOf('\r\n');
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, messages, port: server.address().port };
}

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cspc-lostfound-test-'));
  process.env.DATA_DIR = dataDir;
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'test-only-session-secret';
  smtpEnvironmentKeys.forEach(key => delete process.env[key]);

  const users = [
    fixtureUser('admin-test', 'admin@cspc.edu.ph', adminPassword, 'admin'),
    fixtureUser('student-test', 'student@my.cspc.edu.ph', studentPassword, 'student'),
    fixtureUser('match-student-test', 'match.student@my.cspc.edu.ph', studentPassword, 'student')
  ];
  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify(users));
  fs.writeFileSync(path.join(dataDir, 'items.json'), JSON.stringify([
    {
      id: 11,
      refCode: 'CSPC-LF-2026-011',
      title: 'Found umbrella',
      category: 'Others',
      type: 'found',
      location: 'Main Building',
      desc: 'Black umbrella with a wooden handle.',
      contact: 'private-contact@example.edu',
      verification: 'Private serial clue',
      claimantProof: 'Private claim proof',
      reportedBy: 'reporter-test',
      status: 'active',
      claimed: false,
      createdAt: new Date().toISOString()
    },
    {
      id: 12,
      refCode: 'CSPC-REG-QR-0012',
      title: 'Registered laptop',
      category: 'Electronics',
      type: 'registered',
      location: 'Library',
      contact: 'Owner Name (owner@example.edu)',
      ownerEmail: 'owner@example.edu',
      reportedBy: 'student-test',
      notifications: [],
      status: 'registered',
      claimed: false
    },
    {
      id: 13,
      refCode: 'CSPC-LF-2026-013',
      title: 'Found notebook',
      category: 'Books & Documents',
      type: 'found',
      location: 'Library',
      desc: 'Green notebook with a fabric cover.',
      contact: 'notebook-reporter@example.edu',
      verification: 'Private page detail',
      reportedBy: 'reporter-test',
      status: 'active',
      claimed: false
    },
    {
      id: 14,
      refCode: 'CSPC-LF-2026-014',
      title: 'Found water bottle',
      category: 'Others',
      type: 'found',
      location: 'Gymnasium',
      desc: 'Blue bottle with a silver cap.',
      verification: 'Small star scratched under the base',
      reportedBy: 'reporter-test',
      status: 'active',
      claimed: false
    },
    {
      id: 16,
      refCode: 'CSPC-LF-2026-016',
      title: 'Claimed found jacket',
      category: 'Clothing',
      type: 'found',
      location: 'Cafeteria',
      desc: 'A jacket already returned to its owner.',
      status: 'active',
      claimed: true
    },
    {
      id: 15,
      refCode: 'CSPC-LF-2026-015',
      title: 'Claimed lost wallet',
      category: 'Others',
      type: 'lost',
      location: 'Cafeteria',
      desc: 'A wallet that has been returned to its owner.',
      status: 'claimed',
      claimed: false
    },
    {
      id: 17,
      refCode: 'CSPC-LF-2026-017',
      title: 'Lost green notebook',
      category: 'Books & Documents',
      type: 'lost',
      location: 'Library',
      desc: 'Green notebook with a fabric cover.',
      reportedBy: 'student-test',
      status: 'archived',
      claimed: false
    },
    {
      id: 18,
      refCode: 'CSPC-LF-2026-018',
      title: 'Lost water bottle',
      category: 'Others',
      type: 'lost',
      location: 'Gymnasium',
      desc: 'Blue bottle with a silver cap.',
      reportedBy: 'student-test',
      status: 'archived',
      claimed: false
    }
  ]));

  ({ createApp } = require('../server'));
  appServer = createApp().listen(0);
  await new Promise(resolve => appServer.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${appServer.address().port}`;
});

test.after(async () => {
  if (appServer) await new Promise((resolve, reject) => appServer.close(error => error ? reject(error) : resolve()));
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.SESSION_SECRET;
  smtpEnvironmentKeys.forEach(key => {
    if (originalSmtpEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = originalSmtpEnvironment[key];
  });
  process.env.NODE_ENV = 'development';
});

function registrationBody(overrides = {}) {
  return JSON.stringify({
    fullName: 'New Student',
    studentId: '1010011',
    department: 'College of Computer Studies (CCS)',
    email: 'new.student@my.cspc.edu.ph',
    password: 'StudentPass1!',
    ...overrides
  });
}

async function postJson(url, body) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
}

test('registration accepts only @my.cspc.edu.ph student addresses', async () => {
  for (const email of [
    'admin@cspc.edu.ph',
    'someone@gmail.com',
    'student@my.cspc.edu.ph.evil.com',
    'student@fake.my.cspc.edu.ph',
    'stu dent@my.cspc.edu.ph',
    'a@b@my.cspc.edu.ph'
  ]) {
    const response = await postJson(`${baseUrl}/api/auth/register`, registrationBody({ email, studentId: '1' }));
    assert.equal(response.status, 400, email);
  }
  const loginResponse = await postJson(`${baseUrl}/api/auth/login`, JSON.stringify({ email: 'someone@gmail.com', password: 'StudentPass1!' }));
  assert.equal(loginResponse.status, 400);
});

test('new accounts cannot sign in until the emailed confirmation link is opened', async t => {
  const missingDepartmentResponse = await postJson(`${baseUrl}/api/auth/register`, registrationBody({ department: undefined }));
  assert.equal(missingDepartmentResponse.status, 400);

  const smtp = await startSmtpCaptureServer();
  const mailEnvironment = Object.fromEntries(smtpEnvironmentKeys.map(key => [key, process.env[key]]));
  t.after(async () => {
    await new Promise(resolve => smtp.server.close(resolve));
    Object.entries(mailEnvironment).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(smtp.port);
  process.env.SMTP_SECURE = 'false';
  process.env.SMTP_FROM = 'Back2You <noreply@example.edu>';
  process.env.APP_BASE_URL = baseUrl;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;

  // Someone without access to the inbox registers the address first.
  const squatterResponse = await postJson(`${baseUrl}/api/auth/register`, registrationBody({ password: 'Squatter1!pass' }));
  assert.equal(squatterResponse.status, 201);

  const response = await postJson(`${baseUrl}/api/auth/register`, registrationBody());
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.success, true);
  assert.equal(result.verificationRequired, true);
  assert.equal(result.emailSent, true);
  assert.equal(result.user, undefined);
  assert.equal(response.headers.get('set-cookie'), null);

  const users = JSON.parse(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8'));
  const pending = users.filter(user => user.email === 'new.student@my.cspc.edu.ph');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].emailVerified, false);
  assert.equal(pending[0].department, 'College of Computer Studies (CCS)');
  assert.match(pending[0].verificationTokenHash, /^[a-f0-9]{64}$/);

  const blockedLogin = await postJson(`${baseUrl}/api/auth/login`, JSON.stringify({ email: 'new.student@my.cspc.edu.ph', password: 'StudentPass1!' }));
  assert.equal(blockedLogin.status, 403);
  assert.equal((await blockedLogin.json()).code, 'EMAIL_NOT_VERIFIED');
  assert.equal(blockedLogin.headers.get('set-cookie'), null);

  const forgedLink = await fetch(`${baseUrl}/api/auth/verify-email?token=${'0'.repeat(64)}`, { redirect: 'manual' });
  assert.equal(forgedLink.headers.get('location'), '/login?verified=invalid');

  const squatterEmail = smtp.messages[0].content.replace(/=\r\n/g, '').replace(/=3D/g, '=');
  const squatterToken = squatterEmail.match(/verify-email\?token=([a-f0-9]{64})/)[1];
  const supersededLink = await fetch(`${baseUrl}/api/auth/verify-email?token=${squatterToken}`, { redirect: 'manual' });
  assert.equal(supersededLink.headers.get('location'), '/login?verified=invalid');

  const latestEmail = smtp.messages.at(-1);
  assert.match(latestEmail.recipient, /new\.student@my\.cspc\.edu\.ph/);
  const emailContent = latestEmail.content.replace(/=\r\n/g, '').replace(/=3D/g, '=');
  assert.match(emailContent, /Confirm your Back2You account/);
  const token = emailContent.match(/verify-email\?token=([a-f0-9]{64})/)[1];
  const verifyResponse = await fetch(`${baseUrl}/api/auth/verify-email?token=${token}`, { redirect: 'manual' });
  assert.equal(verifyResponse.status, 302);
  assert.equal(verifyResponse.headers.get('location'), '/login?verified=success');

  const reusedLink = await fetch(`${baseUrl}/api/auth/verify-email?token=${token}`, { redirect: 'manual' });
  assert.equal(reusedLink.headers.get('location'), '/login?verified=invalid');

  const squatterLogin = await postJson(`${baseUrl}/api/auth/login`, JSON.stringify({ email: 'new.student@my.cspc.edu.ph', password: 'Squatter1!pass' }));
  assert.equal(squatterLogin.status, 401);
  await login('new.student@my.cspc.edu.ph', 'StudentPass1!');

  const itemsResponse = await fetch(`${baseUrl}/api/items`);
  assert.equal((await itemsResponse.json()).items.length, 5);

  const duplicateResponse = await postJson(`${baseUrl}/api/auth/register`, registrationBody());
  assert.equal(duplicateResponse.status, 409);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8'))
    .filter(user => user.email === 'new.student@my.cspc.edu.ph').length, 1);
});

test('student accounts cannot sign in with the staff domain and repeated failures are throttled', async () => {
  const staffDomain = await postJson(`${baseUrl}/api/auth/login`, JSON.stringify({ email: 'student@cspc.edu.ph', password: studentPassword }));
  assert.equal(staffDomain.status, 401);

  const email = 'password.guesser@my.cspc.edu.ph';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await postJson(`${baseUrl}/api/auth/login`, JSON.stringify({ email, password: 'WrongPass1!' }));
    assert.equal(response.status, 401);
  }
  const locked = await postJson(`${baseUrl}/api/auth/login`, JSON.stringify({ email, password: 'WrongPass1!' }));
  assert.equal(locked.status, 429);
});

test('server source, scripts and data files are not publicly served', async () => {
  for (const url of ['/services/email.js', '/scripts/manage-admin.js', '/routes/authRoutes.js', '/data/items.json', '/server.js', '/package.json', '/README.md', '/.env']) {
    const response = await fetch(`${baseUrl}${url}`);
    assert.equal(response.status, 404, url);
  }
  const asset = await fetch(`${baseUrl}/js/login.js`);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('x-content-type-options'), 'nosniff');
});

test('forgotten passwords can be reset once through the emailed link', async t => {
  const smtp = await startSmtpCaptureServer();
  const mailEnvironment = Object.fromEntries(smtpEnvironmentKeys.map(key => [key, process.env[key]]));
  t.after(async () => {
    await new Promise(resolve => smtp.server.close(resolve));
    Object.entries(mailEnvironment).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(smtp.port);
  process.env.SMTP_SECURE = 'false';
  process.env.SMTP_FROM = 'Back2You <noreply@example.edu>';
  process.env.APP_BASE_URL = baseUrl;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;

  const outsider = await postJson(`${baseUrl}/api/auth/forgot-password`, JSON.stringify({ email: 'someone@gmail.com' }));
  assert.equal(outsider.status, 400);

  const unknown = await postJson(`${baseUrl}/api/auth/forgot-password`, JSON.stringify({ email: 'nobody.here@my.cspc.edu.ph' }));
  const known = await postJson(`${baseUrl}/api/auth/forgot-password`, JSON.stringify({ email: 'new.student@my.cspc.edu.ph' }));
  assert.equal(unknown.status, 200);
  assert.equal(known.status, 200);
  // Same wording either way, so the form cannot be used to discover accounts.
  assert.equal(
    (await unknown.json()).message.replace('nobody.here', 'X'),
    (await known.json()).message.replace('new.student', 'X')
  );
  assert.equal(smtp.messages.length, 1);
  assert.match(smtp.messages[0].recipient, /new\.student@my\.cspc\.edu\.ph/);

  const emailContent = smtp.messages[0].content.replace(/=\r\n/g, '').replace(/=3D/g, '=');
  assert.match(emailContent, /Reset your Back2You password/);
  const token = emailContent.match(/login\?reset=([a-f0-9]{64})/)[1];

  const weak = await postJson(`${baseUrl}/api/auth/reset-password`, JSON.stringify({ token, password: 'short' }));
  assert.equal(weak.status, 400);

  const forged = await postJson(`${baseUrl}/api/auth/reset-password`, JSON.stringify({ token: 'f'.repeat(64), password: 'BrandNew1!pass' }));
  assert.equal(forged.status, 400);
  assert.equal((await forged.json()).code, 'RESET_LINK_INVALID');

  const reset = await postJson(`${baseUrl}/api/auth/reset-password`, JSON.stringify({ token, password: 'BrandNew1!pass' }));
  assert.equal(reset.status, 200);

  const reused = await postJson(`${baseUrl}/api/auth/reset-password`, JSON.stringify({ token, password: 'Another1!pass' }));
  assert.equal(reused.status, 400);

  const oldPassword = await postJson(`${baseUrl}/api/auth/login`, JSON.stringify({ email: 'new.student@my.cspc.edu.ph', password: 'StudentPass1!' }));
  assert.equal(oldPassword.status, 401);
  await login('new.student@my.cspc.edu.ph', 'BrandNew1!pass');

  const users = JSON.parse(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8'));
  const user = users.find(entry => entry.email === 'new.student@my.cspc.edu.ph');
  assert.equal(user.passwordResetTokenHash, undefined);
});

test('signed-in users can change their password only with the current one', async () => {
  const unauthenticated = await postJson(`${baseUrl}/api/auth/change-password`, JSON.stringify({ currentPassword: 'x', newPassword: 'y' }));
  assert.equal(unauthenticated.status, 401);

  const cookie = await login('new.student@my.cspc.edu.ph', 'BrandNew1!pass');
  const change = body => fetch(`${baseUrl}/api/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body)
  });

  const wrongCurrent = await change({ currentPassword: 'NotMyPass1!', newPassword: 'Changed1!pass' });
  assert.equal(wrongCurrent.status, 400);
  const weak = await change({ currentPassword: 'BrandNew1!pass', newPassword: 'weak' });
  assert.equal(weak.status, 400);
  const same = await change({ currentPassword: 'BrandNew1!pass', newPassword: 'BrandNew1!pass' });
  assert.equal(same.status, 400);

  const changed = await change({ currentPassword: 'BrandNew1!pass', newPassword: 'Changed1!pass' });
  assert.equal(changed.status, 200);
  assert.ok(changed.headers.get('set-cookie'), 'session is re-issued after a password change');

  const oldPassword = await postJson(`${baseUrl}/api/auth/login`, JSON.stringify({ email: 'new.student@my.cspc.edu.ph', password: 'BrandNew1!pass' }));
  assert.equal(oldPassword.status, 401);
  await login('new.student@my.cspc.edu.ph', 'Changed1!pass');

  const users = await fetch(`${baseUrl}/api/auth/users`, { headers: { Cookie: await login('admin@cspc.edu.ph', adminPassword) } });
  const listed = (await users.json()).users;
  assert.ok(listed.every(user => !('passwordHash' in user) && !('passwordResetTokenHash' in user) && !('verificationTokenHash' in user)));
});

test('public item responses exclude private fields', async () => {
  for (const privatePath of ['/data/users.json', '/routes/authRoutes.js', '/server.js', '/package.json']) {
    const response = await fetch(`${baseUrl}${privatePath}`);
    assert.equal(response.status, 404, `${privatePath} should not be publicly served`);
  }

  const response = await fetch(`${baseUrl}/api/items`);
  assert.equal(response.status, 200);
  const { items } = await response.json();
  assert.equal(items.length, 5);
  for (const field of ['contact', 'verification', 'claimantProof', 'reportedBy', 'notifications', 'ownerEmail']) {
    assert.equal(Object.hasOwn(items[0], field), false, `public response should omit ${field}`);
  }
});

test('retries with the same report key return the original item instead of duplicating it', async t => {
  const submissionKey = 'report-submit-duplicate-test-01';
  const report = {
    title: 'Blue insulated water bottle',
    category: 'Others',
    type: 'lost',
    location: 'Library',
    contact: 'student@example.edu',
    desc: 'Blue bottle with a silver cap and a small sticker.'
  };
  t.after(() => {
    const itemsPath = path.join(dataDir, 'items.json');
    const items = JSON.parse(fs.readFileSync(itemsPath, 'utf8'))
      .filter(item => item.submissionKey !== submissionKey);
    fs.writeFileSync(itemsPath, JSON.stringify(items));
  });

  const originalResponse = await fetch(`${baseUrl}/api/items`, {
    method: 'POST',
    headers: { 'Idempotency-Key': submissionKey },
    body: reportFormData(null, report)
  });
  assert.equal(originalResponse.status, 201);
  const original = await originalResponse.json();
  assert.equal(Object.hasOwn(original.item, 'submissionKey'), false);

  const retryResponse = await fetch(`${baseUrl}/api/items`, {
    method: 'POST',
    headers: { 'Idempotency-Key': submissionKey },
    body: reportFormData(null, report)
  });
  assert.equal(retryResponse.status, 200);
  const retry = await retryResponse.json();
  assert.equal(retry.duplicate, true);
  assert.equal(retry.item.id, original.item.id);
  assert.equal(retry.item.refCode, original.item.refCode);

  const changedPayloadResponse = await fetch(`${baseUrl}/api/items`, {
    method: 'POST',
    headers: { 'Idempotency-Key': submissionKey },
    body: reportFormData(null, { ...report, desc: 'A different item description for this report.' })
  });
  assert.equal(changedPayloadResponse.status, 409);

  const savedItems = JSON.parse(fs.readFileSync(path.join(dataDir, 'items.json'), 'utf8'));
  assert.equal(savedItems.filter(item => item.submissionKey === submissionKey).length, 1);
});

test('claimed items are excluded from lost and found results and included in claimed results', async () => {
  const lostResponse = await fetch(`${baseUrl}/api/items?type=lost`);
  assert.equal(lostResponse.status, 200);
  assert.deepEqual((await lostResponse.json()).items, []);

  const foundResponse = await fetch(`${baseUrl}/api/items?type=found`);
  assert.equal(foundResponse.status, 200);
  assert.deepEqual((await foundResponse.json()).items.map(item => item.id), [11, 13, 14]);

  const claimedResponse = await fetch(`${baseUrl}/api/items?status=claimed`);
  assert.equal(claimedResponse.status, 200);
  const claimedItems = (await claimedResponse.json()).items;
  assert.deepEqual(claimedItems.map(item => item.id).sort((a, b) => a - b), [15, 16]);
});

test('home page stats match the public lists and leave out private belongings', async () => {
  const listed = async query => (await (await fetch(`${baseUrl}/api/items${query}`)).json()).items.length;
  const response = await fetch(`${baseUrl}/api/items/stats`);
  assert.equal(response.status, 200);
  const { stats } = await response.json();
  assert.deepEqual(stats, {
    total: await listed(''),
    lost: await listed('?type=lost'),
    found: await listed('?type=found'),
    claimed: await listed('?status=claimed')
  });
});

test('registered belongings are private except through QR reference lookup', async () => {
  const directResponse = await fetch(`${baseUrl}/api/items/12`);
  assert.equal(directResponse.status, 404);

  const idLookup = await fetch(`${baseUrl}/api/items/qr-lookup/12`);
  assert.equal(idLookup.status, 404);

  const qrResponse = await fetch(`${baseUrl}/api/items/qr-lookup/CSPC-REG-QR-0012`);
  assert.equal(qrResponse.status, 200);
  const { item } = await qrResponse.json();
  assert.equal(item.isRegisteredBelonging, true);
  assert.equal(Object.hasOwn(item, 'id'), false);
  assert.equal(Object.hasOwn(item, 'ownerEmail'), false);
});

test('finder QR alerts appear in the owner inbox and are emailed to the owner', async t => {
  const studentCookie = await login('student@my.cspc.edu.ph', studentPassword);
  const smtp = await startSmtpCaptureServer();
  const submissionKey = 'finder-alert-duplicate-test-01';
  const claimsPath = path.join(dataDir, 'claims.json');
  const originalClaims = fs.existsSync(claimsPath) ? fs.readFileSync(claimsPath) : null;
  let notificationId;
  t.after(() => {
    if (notificationId) {
      const itemsPath = path.join(dataDir, 'items.json');
      const items = JSON.parse(fs.readFileSync(itemsPath, 'utf8'));
      const item = items.find(entry => entry.refCode === 'CSPC-REG-QR-0012');
      if (item) item.notifications = item.notifications.filter(notification => notification.id !== notificationId);
      fs.writeFileSync(itemsPath, JSON.stringify(items));
    }
    if (originalClaims === null) fs.rmSync(claimsPath, { force: true });
    else fs.writeFileSync(claimsPath, originalClaims);
  });
  const mailEnvironment = Object.fromEntries(
    smtpEnvironmentKeys.map(key => [key, process.env[key]])
  );
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(smtp.port);
  process.env.SMTP_SECURE = 'false';
  process.env.SMTP_FROM = 'Back2You <noreply@example.edu>';
  process.env.APP_BASE_URL = baseUrl;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;

  let response;
  try {
    response = await fetch(`${baseUrl}/api/items/anonymous-notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': submissionKey },
      body: JSON.stringify({
        refCode: 'CSPC-REG-QR-0012',
        message: 'I found it by the library entrance.',
        locationFound: 'Library entrance',
        finderContact: 'finder@example.edu'
      })
    });
  } finally {
    await new Promise((resolve, reject) => smtp.server.close(error => error ? reject(error) : resolve()));
    Object.entries(mailEnvironment).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.emailSent, true);
  assert.equal(result.notification.read, false);
  assert.equal(Object.hasOwn(result.notification, 'submissionKey'), false);
  notificationId = result.notification.id;
  assert.equal(smtp.messages.length, 1);
  assert.match(smtp.messages[0].recipient, /owner@example\.edu/i);
  const emailContent = smtp.messages[0].content.replace(/=\r\n/g, '');
  assert.match(emailContent, /Finder alert for your registered item: Registered laptop/i);
  assert.match(emailContent, /Library entrance/);
  assert.match(emailContent, /I found it by the library entrance\./);

  const duplicateResponse = await fetch(`${baseUrl}/api/items/anonymous-notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': submissionKey },
    body: JSON.stringify({
      refCode: 'CSPC-REG-QR-0012',
      message: 'I found it by the library entrance.',
      locationFound: 'Library entrance',
      finderContact: 'finder@example.edu'
    })
  });
  assert.equal(duplicateResponse.status, 200);
  const duplicate = await duplicateResponse.json();
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.notification.id, result.notification.id);
  assert.equal(smtp.messages.length, 1, 'a retry must not send a second email');

  const changedPayloadResponse = await fetch(`${baseUrl}/api/items/anonymous-notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': submissionKey },
    body: JSON.stringify({
      refCode: 'CSPC-REG-QR-0012',
      message: 'A different alert using the same key.',
      locationFound: 'Library entrance',
      finderContact: 'finder@example.edu'
    })
  });
  assert.equal(changedPayloadResponse.status, 409);

  const claimNotificationId = 'claim-notif-test';
  fs.writeFileSync(path.join(dataDir, 'claims.json'), JSON.stringify([{
    id: 'claim-test',
    itemId: 11,
    claimantId: 'student-test',
    itemTitle: 'Found umbrella',
    itemRefCode: 'CSPC-LF-2026-011',
    notification: {
      id: claimNotificationId,
      timestamp: new Date().toISOString(),
      read: false,
      message: 'Your claim was rejected.'
    }
  }]));

  const inboxResponse = await fetch(`${baseUrl}/api/items/my-notifications`, {
    headers: { Cookie: studentCookie }
  });
  assert.equal(inboxResponse.status, 200);
  const { notifications, unreadCount } = await inboxResponse.json();
  const finderAlert = notifications.find(notification => notification.refCode === 'CSPC-REG-QR-0012');
  assert.ok(finderAlert);
  assert.equal(finderAlert.message, 'I found it by the library entrance.');
  assert.equal(finderAlert.locationFound, 'Library entrance');
  assert.equal(Object.hasOwn(finderAlert, 'submissionKey'), false);
  assert.equal(notifications.filter(notification => notification.id === result.notification.id).length, 1);
  assert.equal(notifications.some(notification => notification.id === claimNotificationId), true);
  assert.equal(unreadCount, 2);

  const notificationReferences = [
    { kind: 'item', recordId: '12', id: result.notification.id },
    { kind: 'claim', recordId: 'claim-test', id: claimNotificationId }
  ];
  const otherStudentCookie = await login('match.student@my.cspc.edu.ph', studentPassword);
  const otherStudentDelete = await fetch(`${baseUrl}/api/items/notifications`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Cookie: otherStudentCookie },
    body: JSON.stringify({ notificationIds: notificationReferences })
  });
  assert.equal(otherStudentDelete.status, 200);
  assert.equal((await otherStudentDelete.json()).deletedCount, 0);

  const ownerDelete = await fetch(`${baseUrl}/api/items/notifications`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Cookie: studentCookie },
    body: JSON.stringify({ notificationIds: notificationReferences })
  });
  assert.equal(ownerDelete.status, 200);
  assert.equal((await ownerDelete.json()).deletedCount, 2);

  const updatedInbox = await fetch(`${baseUrl}/api/items/my-notifications`, {
    headers: { Cookie: studentCookie }
  });
  const updatedNotifications = await updatedInbox.json();
  assert.equal(updatedNotifications.notifications.some(notification => notification.id === result.notification.id), false);
  assert.equal(updatedNotifications.notifications.some(notification => notification.id === claimNotificationId), false);
  assert.equal(updatedNotifications.unreadCount, 0);
  const savedClaims = JSON.parse(fs.readFileSync(path.join(dataDir, 'claims.json'), 'utf8'));
  assert.equal(savedClaims.length, 1);
  assert.equal(savedClaims[0].notification, null);
});

test('finder QR landing URL serves the app for the anonymous finder screen', async () => {
  const response = await fetch(`${baseUrl}/found?ref=CSPC-REG-QR-0012`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  const html = await response.text();
  assert.match(html, /id="anonymousFinderModal"/);
  const scriptPath = html.match(/src="(\/js\/home-page\.js[^"]*)"/)[1];
  const script = await (await fetch(`${baseUrl}${scriptPath}`)).text();
  assert.match(script, /openAnonymousFinderModal\(finderRef\)/);
});

test('pages send a strict script policy and contain no inline scripts or handlers', async () => {
  for (const url of ['/', '/login', '/about.html']) {
    const response = await fetch(`${baseUrl}${url}`);
    const policy = response.headers.get('content-security-policy');
    assert.match(policy, /script-src 'self'(;|$)/, url);
    assert.match(policy, /object-src 'none'/, url);
    const html = await response.text();
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i, `${url} has an inline <script>`);
    assert.doesNotMatch(html, /\son[a-z]+="/i, `${url} has an inline event handler`);
  }
});

test('page assets are stamped with content versions and cached accordingly', async () => {
  const html = await (await fetch(`${baseUrl}/`)).text();
  const stamped = html.match(/src="(\/js\/ui\.js\?v=[a-f0-9]{10})"/);
  assert.ok(stamped, 'ui.js is versioned');
  const versioned = await fetch(`${baseUrl}${stamped[1]}`);
  assert.equal(versioned.status, 200);
  assert.match(versioned.headers.get('cache-control'), /immutable/);
  const unversioned = await fetch(`${baseUrl}/js/ui.js`);
  assert.equal(unversioned.headers.get('cache-control'), 'no-cache');
  assert.equal((await fetch(`${baseUrl}/`)).headers.get('cache-control'), 'no-cache');
});

test('private registered records are visible to their owner only', async () => {
  const studentCookie = await login('student@my.cspc.edu.ph', studentPassword);
  const ownResponse = await fetch(`${baseUrl}/api/items/12`, { headers: { Cookie: studentCookie } });
  assert.equal(ownResponse.status, 200);
  assert.equal((await ownResponse.json()).item.ownerEmail, 'owner@example.edu');
});

test('only admins can change claim status', async () => {
  const anonymousResponse = await fetch(`${baseUrl}/api/items/11/claim`, { method: 'PATCH' });
  assert.equal(anonymousResponse.status, 401);

  const studentCookie = await login('student@my.cspc.edu.ph', studentPassword);
  const studentResponse = await fetch(`${baseUrl}/api/items/11/claim`, {
    method: 'PATCH',
    headers: { Cookie: studentCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ proof: 'checked' })
  });
  assert.equal(studentResponse.status, 403);

  const adminCookie = await login('admin@cspc.edu.ph', adminPassword);
  const adminResponse = await fetch(`${baseUrl}/api/items/11/claim`, {
    method: 'PATCH',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ proof: 'checked' })
  });
  assert.equal(adminResponse.status, 200);
  assert.equal((await adminResponse.json()).item.claimed, true);
});

test('claim requests are private and require moderator review', async () => {
  const studentCookie = await login('student@my.cspc.edu.ph', studentPassword);
  const requestResponse = await fetch(`${baseUrl}/api/items/13/claim-requests`, {
    method: 'POST',
    headers: { Cookie: studentCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
      proof: 'A small university logo is on the inside cover.',
        lostId: 17,
      courseYear: 'BS Information Technology, 3rd Year',
      contactNumber: '09171234567'
    })
  });
  assert.equal(requestResponse.status, 201);
  const requestData = await requestResponse.json();
  assert.equal(Object.hasOwn(requestData.claim, 'proof'), false);

  const duplicateResponse = await fetch(`${baseUrl}/api/items/13/claim-requests`, {
    method: 'POST',
    headers: { Cookie: studentCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ proof: 'Another private detail about this notebook.', lostId: 17 })
  });
  assert.equal(duplicateResponse.status, 409);

  const studentClaimsResponse = await fetch(`${baseUrl}/api/items/claims`, { headers: { Cookie: studentCookie } });
  assert.equal(studentClaimsResponse.status, 403);

  const adminCookie = await login('admin@cspc.edu.ph', adminPassword);
  const adminClaimsResponse = await fetch(`${baseUrl}/api/items/claims`, { headers: { Cookie: adminCookie } });
  assert.equal(adminClaimsResponse.status, 200);
  const { claims } = await adminClaimsResponse.json();
  assert.equal(claims.length, 1);
  assert.match(claims[0].proof, /university logo/);
  assert.equal(claims[0].claimantStudentId, '2026001');
  assert.equal(claims[0].claimantCourseYear, 'BS Information Technology, 3rd Year');
  assert.equal(claims[0].claimantContact, '09171234567');

  const reviewResponse = await fetch(`${baseUrl}/api/items/claims/${encodeURIComponent(claims[0].id)}`, {
    method: 'PATCH',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'approved', pickupInstructions: 'Present your CSPC Student ID at SAS Office, Room 101.' })
  });
  assert.equal(reviewResponse.status, 200);
  assert.equal((await reviewResponse.json()).claim.pickupInstructions, 'Present your CSPC Student ID at SAS Office, Room 101.');

  const itemResponse = await fetch(`${baseUrl}/api/items/13`);
  assert.equal((await itemResponse.json()).item.claimed, true);

  const notificationsResponse = await fetch(`${baseUrl}/api/items/my-notifications`, { headers: { Cookie: studentCookie } });
  const { notifications } = await notificationsResponse.json();
  assert.equal(notifications[0].notificationType, 'claim');
  assert.match(notifications[0].message, /Room 101/);

  const readResponse = await fetch(`${baseUrl}/api/items/notifications/${encodeURIComponent(notifications[0].id)}/read`, {
    method: 'PATCH',
    headers: { Cookie: studentCookie }
  });
  assert.equal(readResponse.status, 200);
  const readNotificationsResponse = await fetch(`${baseUrl}/api/items/my-notifications`, { headers: { Cookie: studentCookie } });
  assert.equal((await readNotificationsResponse.json()).unreadCount, 0);
});

test('rejected claims restore availability and notify the claimant', async () => {
  const studentCookie = await login('student@my.cspc.edu.ph', studentPassword);
  const claimResponse = await fetch(`${baseUrl}/api/items/14/claim-requests`, {
    method: 'POST',
    headers: { Cookie: studentCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ proof: 'A small star is scratched under the base.', lostId: 18 })
  });
  assert.equal(claimResponse.status, 201);

  const adminCookie = await login('admin@cspc.edu.ph', adminPassword);
  const claimsResponse = await fetch(`${baseUrl}/api/items/claims`, { headers: { Cookie: adminCookie } });
  const { claims } = await claimsResponse.json();
  const claim = claims.find(entry => String(entry.itemId) === '14');
  assert.ok(claim);

  const reviewResponse = await fetch(`${baseUrl}/api/items/claims/${encodeURIComponent(claim.id)}`, {
    method: 'PATCH',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'rejected', rejectionReason: 'The proof does not match the item.' })
  });
  assert.equal(reviewResponse.status, 200);
  assert.equal((await reviewResponse.json()).claim.rejectionReason, 'The proof does not match the item.');

  const itemResponse = await fetch(`${baseUrl}/api/items/14`);
  const { item } = await itemResponse.json();
  assert.equal(item.status, 'active');
  assert.equal(item.claimed, false);

  const notificationsResponse = await fetch(`${baseUrl}/api/items/my-notifications`, { headers: { Cookie: studentCookie } });
  const { notifications } = await notificationsResponse.json();
  assert.equal(notifications[0].notificationType, 'claim');
  assert.match(notifications[0].message, /does not match/);
});

test('possible-match alerts notify the lost-report student whether the found report is earlier or later', async () => {
  const studentCookie = await login('match.student@my.cspc.edu.ph', studentPassword);
  const firstPair = {
    title: 'Cerulean astrophotography camera',
    category: 'Electronics',
    location: 'College of Computer Studies (CCS)',
    contact: 'match.student@my.cspc.edu.ph',
    desc: 'Engraved constellation map on the battery cover.',
    verification: 'Gold comet sticker under the hinge'
  };

  const firstLostResponse = await fetch(`${baseUrl}/api/items`, {
    method: 'POST',
    headers: { Cookie: studentCookie },
    body: reportFormData(null, { ...firstPair, type: 'lost' })
  });
  assert.equal(firstLostResponse.status, 201);
  const firstLost = (await firstLostResponse.json()).item;

  const smtp = await startSmtpCaptureServer();
  const mailEnvironment = Object.fromEntries(
    ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'APP_BASE_URL']
      .map(key => [key, process.env[key]])
  );
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(smtp.port);
  process.env.SMTP_SECURE = 'false';
  process.env.SMTP_FROM = 'Back2You <noreply@example.edu>';
  process.env.APP_BASE_URL = baseUrl;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;

  let firstFoundResponse;
  try {
    firstFoundResponse = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      body: reportFormData(null, { ...firstPair, type: 'found' })
    });
  } finally {
    await new Promise((resolve, reject) => smtp.server.close(error => error ? reject(error) : resolve()));
    Object.entries(mailEnvironment).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
  assert.equal(firstFoundResponse.status, 201);
  const firstFound = (await firstFoundResponse.json()).item;
  assert.equal(smtp.messages.length, 1);
  assert.match(smtp.messages[0].recipient, /match\.student@my\.cspc\.edu\.ph/i);
  const emailContent = smtp.messages[0].content.replace(/=\r\n/g, '');
  assert.match(emailContent, /Possible match for your Back2You lost-item report/i);
  assert.ok(emailContent.includes(firstLost.refCode));
  assert.ok(emailContent.includes(firstFound.refCode));
  assert.match(emailContent, /Your lost-item report: Cerulean astrophotography camera/i);
  assert.match(emailContent, /Possible found-item match: Cerulean astrophotography camera/i);
  assert.match(emailContent, /Reported location: College of Computer Studies \(CCS\)/);
  assert.match(emailContent, /does not confirm ownership/i);
  assert.match(emailContent, /verify your ownership/i);
  assert.doesNotMatch(emailContent, /Student Affairs and Services|Campus Security Desk|General Services Unit/i);
  assert.doesNotMatch(emailContent, /Gold comet sticker under the hinge/);

  const secondPair = {
    title: 'Silver robotics team hoodie',
    category: 'Clothing & Accessories',
    location: 'College of Engineering and Architecture (CEA)',
    contact: 'match.student@my.cspc.edu.ph',
    desc: 'Embroidered blue gear on the left sleeve.',
    verification: 'Initials R K inside the collar'
  };
  const secondFoundResponse = await fetch(`${baseUrl}/api/items`, {
    method: 'POST',
    body: reportFormData(null, { ...secondPair, type: 'found' })
  });
  assert.equal(secondFoundResponse.status, 201);
  const secondFound = (await secondFoundResponse.json()).item;

  const secondLostResponse = await fetch(`${baseUrl}/api/items`, {
    method: 'POST',
    headers: { Cookie: studentCookie },
    body: reportFormData(null, { ...secondPair, type: 'lost' })
  });
  assert.equal(secondLostResponse.status, 201);
  const secondLost = (await secondLostResponse.json()).item;

  const mismatchedCategoryPair = {
    title: 'Graphing scientific calculator',
    location: 'Library',
    contact: 'guest@example.edu',
    desc: 'Casio fx calculator with a cracked lower-right corner.'
  };
  const mismatchedCategoryLostResponse = await fetch(`${baseUrl}/api/items`, {
    method: 'POST',
    body: reportFormData(null, {
      ...mismatchedCategoryPair,
      type: 'lost',
      category: 'Electronics'
    })
  });
  assert.equal(mismatchedCategoryLostResponse.status, 201);
  const mismatchedCategoryLost = (await mismatchedCategoryLostResponse.json()).item;
  const mismatchedCategoryFoundResponse = await fetch(`${baseUrl}/api/items`, {
    method: 'POST',
    body: reportFormData(null, {
      ...mismatchedCategoryPair,
      type: 'found',
      category: 'Others'
    })
  });
  assert.equal(mismatchedCategoryFoundResponse.status, 201);
  const mismatchedCategoryFound = (await mismatchedCategoryFoundResponse.json()).item;

  const notificationsResponse = await fetch(`${baseUrl}/api/items/my-notifications`, {
    headers: { Cookie: studentCookie }
  });
  assert.equal(notificationsResponse.status, 200);
  const { notifications, unreadCount } = await notificationsResponse.json();
  const matchNotifications = notifications.filter(notification => notification.notificationType === 'match');
  assert.equal(matchNotifications.length, 2);
  assert.equal(unreadCount, 2);
  assert.deepEqual(
    new Set(matchNotifications.map(notification => notification.matchItemId)),
    new Set([firstFound.id, secondFound.id])
  );
  assert.deepEqual(
    new Set(matchNotifications.map(notification => notification.itemTitle)),
    new Set([firstLost.title, secondLost.title])
  );
  assert.ok(matchNotifications.every(notification => /may match/i.test(notification.message)));
  assert.ok(matchNotifications.every(notification => !Object.hasOwn(notification, 'verification')));

  const savedItems = JSON.parse(fs.readFileSync(path.join(dataDir, 'items.json'), 'utf8'));
  const savedLost = savedItems.find(item => String(item.id) === String(firstLost.id));
  const savedFound = savedItems.find(item => String(item.id) === String(firstFound.id));
  assert.ok(savedLost.matches.some(match => String(match.itemId) === String(firstFound.id)));
  assert.ok(savedFound.matches.some(match => String(match.itemId) === String(firstLost.id)));
  const savedMismatchedCategoryLost = savedItems.find(item =>
    String(item.id) === String(mismatchedCategoryLost.id)
  );
  const savedMismatchedCategoryFound = savedItems.find(item =>
    String(item.id) === String(mismatchedCategoryFound.id)
  );
  assert.ok(savedMismatchedCategoryLost.matches.some(match =>
    String(match.itemId) === String(mismatchedCategoryFound.id)
  ));
  assert.ok(savedMismatchedCategoryFound.matches.some(match =>
    String(match.itemId) === String(mismatchedCategoryLost.id)
  ));
});

test('image upload stores a bounded image file and rejects invalid uploads', async () => {
  const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2sAAAAASUVORK5CYII=', 'base64');
  const validResponse = await fetch(`${baseUrl}/api/items`, {
    method: 'POST',
    body: reportFormData(new Blob([pngBytes], { type: 'image/png' }))
  });
  assert.equal(validResponse.status, 201);
  const { item } = await validResponse.json();
  assert.match(item.photo, /^\/uploads\/[a-f0-9-]+\.png$/);
  assert.equal(fs.existsSync(path.join(dataDir, 'uploads', path.basename(item.photo))), true);

  const photoResponse = await fetch(`${baseUrl}/api/items/${item.id}/photo`);
  assert.equal(photoResponse.status, 200);
  assert.match(photoResponse.headers.get('content-type') || '', /^image\/png/);
  assert.deepEqual(Buffer.from(await photoResponse.arrayBuffer()), pngBytes);

  const invalidResponse = await fetch(`${baseUrl}/api/items`, {
    method: 'POST',
    body: reportFormData(new Blob([Buffer.from('not an image')], { type: 'image/png' }))
  });
  assert.equal(invalidResponse.status, 400);

  const oversizedResponse = await fetch(`${baseUrl}/api/items`, {
    method: 'POST',
    body: reportFormData(new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)], { type: 'image/png' }))
  });
  assert.equal(oversizedResponse.status, 413);
});

test('production requires a secret and persists secure sessions', async () => {
  process.env.NODE_ENV = 'production';
  delete process.env.SESSION_SECRET;
  assert.throws(createApp, /SESSION_SECRET must be configured in production/);

  process.env.SESSION_SECRET = 'production-test-session-secret';
  const productionServer = createApp().listen(0);
  await new Promise(resolve => productionServer.once('listening', resolve));
  try {
    const productionUrl = `http://127.0.0.1:${productionServer.address().port}`;
    const loginResponse = await fetch(`${productionUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
      body: JSON.stringify({ email: 'admin@cspc.edu.ph', password: adminPassword })
    });
    assert.equal(loginResponse.status, 200, await loginResponse.clone().text());
    const cookieHeader = loginResponse.headers.get('set-cookie');
    assert.match(cookieHeader, /Secure/i);
    assert.match(cookieHeader, /SameSite=Lax/i);
    const sessionCookie = cookieHeader.split(';')[0];
    const sessionResponse = await fetch(`${productionUrl}/api/auth/me`, { headers: { Cookie: sessionCookie } });
    assert.equal((await sessionResponse.json()).authenticated, true);
    assert.ok(fs.readdirSync(path.join(dataDir, 'sessions')).length > 0);
  } finally {
    await new Promise((resolve, reject) => productionServer.close(error => error ? reject(error) : resolve()));
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'test-only-session-secret';
  }
});

test('missing Supabase configuration does not silently fall back to JSON files', () => {
  const keys = ['DATABASE_URL', 'SUPABASE_DB_URL'];
  const originalEnvironment = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    keys.forEach(key => delete process.env[key]);
    const postgresStore = require('../services/postgresStore');
    assert.equal(postgresStore.isConfigured(), false);
  } finally {
    keys.forEach(key => {
      if (originalEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnvironment[key];
    });
  }
});

test('production admin password reset is explicit and only affects the configured admin', async () => {
  const usersPath = path.join(dataDir, 'users.json');
  const originalUsers = fs.readFileSync(usersPath, 'utf8');
  const originalStudentPasswordHash = JSON.parse(originalUsers)
    .find(user => user.email === 'student@my.cspc.edu.ph').passwordHash;
  const environmentKeys = ['NODE_ENV', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'ADMIN_PASSWORD_RESET'];
  const originalEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));

  try {
    process.env.NODE_ENV = 'production';
    process.env.ADMIN_EMAIL = 'admin@cspc.edu.ph';
    process.env.ADMIN_PASSWORD = 'NewAdminPassword123!';
    process.env.ADMIN_PASSWORD_RESET = 'true';

    const authRoutes = require('../routes/authRoutes');
    authRoutes.ensureDefaultAdminAccount();

    const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    const admin = users.find(user => user.email === 'admin@cspc.edu.ph');
    const student = users.find(user => user.email === 'student@my.cspc.edu.ph');
    assert.equal(await bcrypt.compare('NewAdminPassword123!', admin.passwordHash), true);
    assert.equal(student.passwordHash, originalStudentPasswordHash);

    process.env.ADMIN_PASSWORD_RESET = 'false';
    process.env.ADMIN_PASSWORD = 'DifferentAdminPassword456!';
    authRoutes.ensureDefaultAdminAccount();
    const unchangedAdmin = JSON.parse(fs.readFileSync(usersPath, 'utf8'))
      .find(user => user.email === 'admin@cspc.edu.ph');
    assert.equal(await bcrypt.compare('NewAdminPassword123!', unchangedAdmin.passwordHash), true);
    assert.equal(await bcrypt.compare('DifferentAdminPassword456!', unchangedAdmin.passwordHash), false);
  } finally {
    fs.writeFileSync(usersPath, originalUsers);
    environmentKeys.forEach(key => {
      if (originalEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnvironment[key];
    });
  }
});

test('production startup requires Supabase configuration', async () => {
  const childEnvironment = {
    ...process.env,
    NODE_ENV: 'production',
    SESSION_SECRET: 'test-module-start-secret',
    ADMIN_EMAIL: 'admin@cspc.edu.ph',
    ADMIN_PASSWORD: 'ProductionStrongTestPass1!'
  };
  ['DATABASE_URL', 'SUPABASE_DB_URL'].forEach(key => delete childEnvironment[key]);
  const child = spawn(process.execPath, ['-e', "require('./server')"], {
    cwd: path.join(__dirname, '..'),
    env: childEnvironment,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  const processExit = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server did not exit. Logs: ${logs}`)), 3500);
    child.stdout.on('data', chunk => { logs += chunk.toString(); });
    child.stderr.on('data', chunk => { logs += chunk.toString(); });
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });

  const { code } = await processExit;
  assert.equal(code, 1);
  assert.match(logs, /DATABASE_URL is required in production for Supabase PostgreSQL/);
});
