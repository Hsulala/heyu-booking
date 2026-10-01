import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { pushLineMessage, replyLineMessage, verifyLineIdToken, verifyWebhookSignature } from './lib/line.mjs';

const port = Number(process.env.PORT || 3000);
const publicDir = join(import.meta.dirname, 'public');
const bookingRequests = [];
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
    bookingRequests.push(booking);

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
