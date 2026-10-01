import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { dirname, extname, join, normalize } from 'node:path';
import { pushLineMessage, replyLineMessage, verifyLineIdToken, verifyWebhookSignature } from './lib/line.mjs';

const port = Number(process.env.PORT || 3000);
const publicDir = join(import.meta.dirname, 'public');
const dataFile = process.env.DATA_FILE ?? '';
const settingsFile = dataFile ? `${dataFile}.settings` : '';
const membersFile = dataFile ? `${dataFile}.members` : '';

function loadBookingRequests() {
  if (!dataFile || !existsSync(dataFile)) return [];
  try {
    const value = JSON.parse(readFileSync(dataFile, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    console.error('Booking data load error:', error.message);
    return [];
  }
}

const bookingRequests = loadBookingRequests();
let operatingSettings = {};
let members = [];
if (settingsFile && existsSync(settingsFile)) {
  try { operatingSettings = JSON.parse(readFileSync(settingsFile, 'utf8')) ?? {}; }
  catch (error) { console.error('Settings data load error:', error.message); }
}
if (membersFile && existsSync(membersFile)) {
  try {
    const value = JSON.parse(readFileSync(membersFile, 'utf8'));
    members = Array.isArray(value) ? value : [];
  } catch (error) { console.error('Member data load error:', error.message); }
}

function saveBookingRequests() {
  if (!dataFile) return;
  writeJsonFile(dataFile, bookingRequests);
}

function saveOperatingSettings() {
  if (!settingsFile) return;
  writeJsonFile(settingsFile, operatingSettings);
}

function saveMembers() {
  if (!membersFile) return;
  writeJsonFile(membersFile, members);
}

function writeJsonFile(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(temporaryPath, filePath);
}
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function json(response, status, value) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

async function readBody(request, limit = 1_000_000) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new Error('Request body is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function handleLineAuth(request, response) {
  try {
    const rawBody = await readBody(request);
    const { idToken } = JSON.parse(rawBody.toString('utf8'));
    const profile = await verifyLineIdToken(idToken, process.env.LINE_LOGIN_CHANNEL_ID);
    json(response, 200, { authenticated: true, profile });
  } catch (error) {
    json(response, 401, { authenticated: false, error: error.message });
  }
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function therapistCanServe(therapist, service) {
  if (!therapist) return true;
  const teachers = operatingSettings.therapists?.teachers ?? {};
  const hasAssignments = Object.values(teachers).some((skills) => Array.isArray(skills) && skills.length);
  return !hasAssignments || (Array.isArray(teachers[therapist]) && teachers[therapist].includes(service));
}

async function handleCreateBooking(request, response) {
  try {
    const rawBody = await readBody(request);
    const values = JSON.parse(rawBody.toString('utf8'));
    const profile = await verifyLineIdToken(values.idToken, process.env.LINE_LOGIN_CHANNEL_ID);
    const booking = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      date: cleanText(values.date, 10),
      time: cleanText(values.time, 5),
      branch: cleanText(values.branch, 40),
      service: cleanText(values.service, 80),
      partySize: values.partySize === '2' ? '2' : '1',
      therapist: cleanText(values.therapist, 40),
      customer: cleanText(values.name, 30),
      phone: cleanText(values.phone, 20),
      note: cleanText(values.note, 300),
      lineUserId: profile.userId,
      status: 'pending',
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(booking.date) || !/^\d{2}:\d{2}$/.test(booking.time)) {
      throw new Error('請選擇有效的日期與時間');
    }
    if (!booking.customer || !booking.phone || !booking.service) throw new Error('預約資料不完整');
    if (!therapistCanServe(booking.therapist, booking.service)) throw new Error('指定老師未提供這項療程');
    bookingRequests.push(booking);
    saveBookingRequests();

    const party = booking.partySize === '2' ? '雙人' : '單人';
    const confirmation = [
      '禾域已收到您的預約需求 🌿',
      `${booking.date} ${booking.time}`,
      `${party}・${booking.service}`,
      booking.therapist ? `指定老師：${booking.therapist}` : '老師：不指定',
      '',
      '目前尚未正式成立，請等候店家確認。',
    ].join('\n');
    let lineNotification = true;
    try {
      await pushLineMessage(
        profile.userId,
        [{ type: 'text', text: confirmation }],
        process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN,
      );
    } catch (error) {
      lineNotification = false;
      console.error('LINE booking confirmation error:', error.message);
    }

    json(response, 201, {
      booking: { id: booking.id, date: booking.date, time: booking.time, status: booking.status },
      lineNotification,
    });
  } catch (error) {
    json(response, 400, { error: error.message });
  }
}

function handleListBookings(request, response) {
  const configuredKey = process.env.ADMIN_ACCESS_KEY;
  if (!configuredKey) {
    json(response, 503, { error: '後台尚未設定 ADMIN_ACCESS_KEY' });
    return;
  }
  if (request.headers['x-admin-key'] !== configuredKey) {
    json(response, 401, { error: '後台存取碼不正確' });
    return;
  }
  json(response, 200, { bookings: bookingRequests.slice().reverse() });
}

async function handleCreateAdminBooking(request, response) {
  if (!hasAdminAccess(request)) {
    json(response, 401, { error: '後台存取碼不正確' });
    return;
  }
  try {
    const values = JSON.parse((await readBody(request)).toString('utf8'));
    const booking = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      date: cleanText(values.date, 10),
      time: cleanText(values.time, 5),
      branch: cleanText(values.branch || '禾域本店', 40),
      service: cleanText(values.service, 80),
      partySize: values.partySize === '2' ? '2' : '1',
      therapist: cleanText(values.therapist, 40),
      customer: cleanText(values.customer, 30),
      phone: cleanText(values.phone, 20),
      note: cleanText(values.note, 300),
      lineUserId: '',
      status: 'confirmed',
      source: 'staff_manual',
    };
    if (!booking.customer || !booking.service || !/^\d{4}-\d{2}-\d{2}$/.test(booking.date) || !/^\d{2}:\d{2}$/.test(booking.time)) {
      throw new Error('預約資料不完整');
    }
    if (!therapistCanServe(booking.therapist, booking.service)) throw new Error('指定老師未提供這項療程');
    bookingRequests.push(booking);
    saveBookingRequests();
    json(response, 201, { booking });
  } catch (error) { json(response, 400, { error: error.message }); }
}

async function handleMembers(request, response) {
  if (!hasAdminAccess(request)) {
    json(response, 401, { error: '後台存取碼不正確' });
    return;
  }
  if (request.method === 'GET') {
    json(response, 200, { members: members.slice().reverse() });
    return;
  }
  try {
    const values = JSON.parse((await readBody(request)).toString('utf8'));
    const member = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      name: cleanText(values.name, 30),
      phone: cleanText(values.phone, 20),
      note: cleanText(values.note, 300),
    };
    if (!member.name) throw new Error('請填寫會員姓名');
    members.push(member);
    saveMembers();
    json(response, 201, { member });
  } catch (error) { json(response, 400, { error: error.message }); }
}

function hasAdminAccess(request) {
  return Boolean(process.env.ADMIN_ACCESS_KEY)
    && request.headers['x-admin-key'] === process.env.ADMIN_ACCESS_KEY;
}

async function handleUpdateBooking(request, response, bookingId) {
  if (!hasAdminAccess(request)) {
    json(response, 401, { error: '後台存取碼不正確' });
    return;
  }
  try {
    const rawBody = await readBody(request);
    const { status } = JSON.parse(rawBody.toString('utf8'));
    if (!['confirmed', 'rejected'].includes(status)) throw new Error('不支援的預約狀態');
    const booking = bookingRequests.find((item) => item.id === bookingId);
    if (!booking) {
      json(response, 404, { error: '找不到這筆預約' });
      return;
    }
    booking.status = status;
    booking.updatedAt = new Date().toISOString();
    saveBookingRequests();
    const isConfirmed = status === 'confirmed';
    const message = isConfirmed
      ? `禾域已確認您的預約 ✅\n${booking.date} ${booking.time}\n${booking.service}\n期待您的到來。`
      : `禾域暫時無法接受這次預約\n${booking.date} ${booking.time}\n請重新選擇其他時段，或直接與店家聯絡。`;
    let lineNotification = true;
    try {
      await pushLineMessage(
        booking.lineUserId,
        [{ type: 'text', text: message }],
        process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN,
      );
    } catch (error) {
      lineNotification = false;
      console.error('LINE booking status notification error:', error.message);
    }
    json(response, 200, { booking, lineNotification });
  } catch (error) {
    json(response, 400, { error: error.message });
  }
}

async function handleSettings(request, response) {
  if (!hasAdminAccess(request)) {
    json(response, 401, { error: '後台存取碼不正確' });
    return;
  }
  if (request.method === 'GET') {
    json(response, 200, { settings: operatingSettings });
    return;
  }
  try {
    const rawBody = await readBody(request);
    const { key, values } = JSON.parse(rawBody.toString('utf8'));
    if (!['services', 'therapists', 'hours', 'rewards', 'reminders', 'branches'].includes(key)) {
      throw new Error('不支援的設定項目');
    }
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('設定格式不正確');
    operatingSettings = { ...operatingSettings, [key]: values };
    saveOperatingSettings();
    json(response, 200, { settings: operatingSettings });
  } catch (error) {
    json(response, 400, { error: error.message });
  }
}

async function handleLineWebhook(request, response) {
  let rawBody;
  try {
    rawBody = await readBody(request);
  } catch (error) {
    json(response, 413, { error: error.message });
    return;
  }

  const signature = request.headers['x-line-signature'];
  if (!verifyWebhookSignature(rawBody, signature, process.env.LINE_MESSAGING_CHANNEL_SECRET)) {
    json(response, 401, { error: 'Invalid LINE webhook signature' });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    json(response, 400, { error: 'Invalid JSON' });
    return;
  }

  // Acknowledge first so LINE is not held up by outbound reply calls.
  json(response, 200, { ok: true });

  const liffUrl = process.env.LINE_LIFF_ID
    ? `https://liff.line.me/${process.env.LINE_LIFF_ID}`
    : 'https://heyu-booking-production-bcf9.up.railway.app/booking';
  const accessToken = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;

  for (const event of payload.events ?? []) {
    const isBookingMessage = event.type === 'message'
      && event.message?.type === 'text'
      && /預約|booking/i.test(event.message.text);
    if (event.type !== 'follow' && !isBookingMessage) continue;

    const text = event.type === 'follow'
      ? `歡迎加入禾域。請由這裡開始預約：\n${liffUrl}`
      : `請開啟禾域預約頁：\n${liffUrl}`;
    replyLineMessage(event.replyToken, [{ type: 'text', text }], accessToken)
      .catch((error) => console.error('LINE reply error:', error.message));
  }
}

function serveStatic(pathname, response) {
  const aliases = { '/': '/index.html', '/admin': '/index.html', '/booking': '/booking.html' };
  const requested = aliases[pathname] ?? pathname;
  const safePath = normalize(requested).replace(/^([/\\]*\.\.(\/|\\|$))+/, '');
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('找不到頁面');
    return;
  }

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;

  if (request.method === 'GET' && pathname === '/healthz') {
    json(response, 200, { status: 'ok' });
    return;
  }
  if (request.method === 'GET' && pathname === '/api/config') {
    json(response, 200, {
      liffId: process.env.LINE_LIFF_ID ?? '',
      lineLoginChannelId: process.env.LINE_LOGIN_CHANNEL_ID ?? '',
    });
    return;
  }
  if (request.method === 'GET' && pathname === '/api/booking-options') {
    json(response, 200, {
      services: ['身體精油按摩 60 分', '深層舒壓 90 分', '筋膜刀 60 分'],
      therapists: operatingSettings.therapists?.teachers ?? {},
    });
    return;
  }
  if (request.method === 'GET' && pathname === '/api/integration-status') {
    json(response, 200, {
      liff: Boolean(process.env.LINE_LIFF_ID && process.env.LINE_LOGIN_CHANNEL_ID),
      webhook: Boolean(
        process.env.LINE_MESSAGING_CHANNEL_SECRET
        && process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN
      ),
    });
    return;
  }
  if (request.method === 'POST' && pathname === '/api/auth/line') {
    await handleLineAuth(request, response);
    return;
  }
  if (request.method === 'POST' && pathname === '/api/bookings') {
    await handleCreateBooking(request, response);
    return;
  }
  if (request.method === 'GET' && pathname === '/api/admin/bookings') {
    handleListBookings(request, response);
    return;
  }
  if (request.method === 'POST' && pathname === '/api/admin/bookings') {
    await handleCreateAdminBooking(request, response);
    return;
  }
  if ((request.method === 'GET' || request.method === 'POST') && pathname === '/api/admin/members') {
    await handleMembers(request, response);
    return;
  }
  const bookingStatusMatch = pathname.match(/^\/api\/admin\/bookings\/([^/]+)\/status$/);
  if (request.method === 'PATCH' && bookingStatusMatch) {
    await handleUpdateBooking(request, response, decodeURIComponent(bookingStatusMatch[1]));
    return;
  }
  if ((request.method === 'GET' || request.method === 'PUT') && pathname === '/api/admin/settings') {
    await handleSettings(request, response);
    return;
  }
  if (request.method === 'POST' && pathname === '/webhooks/line') {
    await handleLineWebhook(request, response);
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    json(response, 405, { error: 'Method not allowed' });
    return;
  }
  serveStatic(pathname, response);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`HEYU is ready at http://localhost:${port}`);
});
