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

test('registration succeeds and reports when confirmation email SMTP is not configured', async () => {
  const adminRegistrationResponse = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Impostor',
      studentId: '1010012',
      department: 'College of Computer Studies (CCS)',
      email: 'admin@cspc.edu.ph',
      password: 'StrongPassword1!'
    })
  });
  assert.equal(adminRegistrationResponse.status, 400);

  const missingDepartmentResponse = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'New Student',
      studentId: '1010011',
      email: 'new.student@my.cspc.edu.ph',
      password: 'StudentPass1!'
    })
  });
  assert.equal(missingDepartmentResponse.status, 400);

  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'New Student',
      studentId: '1010011',
      department: 'College of Computer Studies (CCS)',
      email: 'new.student@my.cspc.edu.ph',
      password: 'StudentPass1!'
    })
  });

  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.success, true);
  assert.equal(result.emailSent, false);
  assert.match(result.message, /confirmation email could not be sent/i);
  const users = JSON.parse(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8'));
  const registeredUser = users.find(user => user.email === 'new.student@my.cspc.edu.ph');
  assert.ok(registeredUser);
  assert.equal(registeredUser.department, 'College of Computer Studies (CCS)');

  const sessionCookie = response.headers.get('set-cookie').split(';')[0];
  await new Promise((resolve, reject) => appServer.close(error => error ? reject(error) : resolve()));
  appServer = createApp().listen(0);
  await new Promise(resolve => appServer.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${appServer.address().port}`;

  const sessionResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: sessionCookie }
  });
  assert.equal((await sessionResponse.json()).authenticated, true);

  const itemsResponse = await fetch(`${baseUrl}/api/items`);
  assert.equal((await itemsResponse.json()).items.length, 5);

  const duplicateResponse = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'New Student',
      studentId: '1010011',
      department: 'College of Computer Studies (CCS)',
      email: 'new.student@my.cspc.edu.ph',
      password: 'StudentPass1!'
    })
  });
  assert.equal(duplicateResponse.status, 409);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8'))
    .filter(user => user.email === 'new.student@my.cspc.edu.ph').length, 1);
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
    body: JSON.stringify({ proof: 'Another private detail about this notebook.' })
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
    body: JSON.stringify({ proof: 'A small star is scratched under the base.' })
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
  const configuredDataDir = process.env.DATA_DIR;
  delete process.env.DATA_DIR;
  assert.throws(createApp, /DATA_DIR must be configured in production/);
  process.env.DATA_DIR = 'relative-data';
  assert.throws(createApp, /DATA_DIR must be an absolute path in production/);
  process.env.DATA_DIR = configuredDataDir;

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

test('production server starts when loaded as a hosting entry module', async () => {
  const bootDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cspc-lostfound-boot-'));
  fs.writeFileSync(path.join(bootDataDir, 'users.json'), JSON.stringify([
    { id: 'usr-admin-01', email: 'legacy-admin@example.edu', role: 'admin' },
    { id: 'kept-user', email: 'student@my.cspc.edu.ph', role: 'student' }
  ]));
  const portProbe = net.createServer();
  await new Promise((resolve, reject) => {
    portProbe.once('error', reject);
    portProbe.listen(0, '127.0.0.1', resolve);
  });
  const port = portProbe.address().port;
  await new Promise((resolve, reject) => portProbe.close(error => error ? reject(error) : resolve()));

  const child = spawn(process.execPath, ['-e', "require('./server')"], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      DATA_DIR: bootDataDir,
      NODE_ENV: 'production',
      PORT: String(port),
      SESSION_SECRET: 'test-module-start-secret',
      ADMIN_EMAIL: 'admin@cspc.edu.ph',
      ADMIN_PASSWORD: 'ProductionStrongTestPass1!'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  const startup = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server did not start. Logs: ${logs}`)), 3500);
    child.stdout.on('data', chunk => {
      logs += chunk.toString();
      if (logs.includes('Server running')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on('data', chunk => { logs += chunk.toString(); });
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`Server exited with code ${code}. Logs: ${logs}`));
    });
  });

  try {
    await startup;
    const response = await fetch(`http://127.0.0.1:${port}/api/items`);
    assert.equal(response.status, 200);
    const users = JSON.parse(fs.readFileSync(path.join(bootDataDir, 'users.json'), 'utf8'));
    assert.deepEqual(users.map(user => user.email), [
      'legacy-admin@example.edu',
      'student@my.cspc.edu.ph',
      'admin@cspc.edu.ph'
    ]);
    assert.match(users[2].id, /^usr-admin-/);

    const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
      body: JSON.stringify({ email: 'admin@cspc.edu.ph', password: 'ProductionStrongTestPass1!' })
    });
    assert.equal(loginResponse.status, 200);
    assert.equal((await loginResponse.json()).user.role, 'admin');
    const sessionCookie = loginResponse.headers.get('set-cookie').split(';')[0];
    const claimsResponse = await fetch(`http://127.0.0.1:${port}/api/items/claims`, {
      headers: { Cookie: sessionCookie }
    });
    assert.equal(claimsResponse.status, 200);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
    }
    fs.rmSync(bootDataDir, { recursive: true, force: true });
  }
});
