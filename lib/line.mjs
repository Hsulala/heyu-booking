import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyWebhookSignature(body, signature, channelSecret) {
  if (!body || !signature || !channelSecret) return false;
  const expected = createHmac('sha256', channelSecret).update(body).digest('base64');
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length
    && timingSafeEqual(receivedBuffer, expectedBuffer);
}

export async function verifyLineIdToken(idToken, channelId, fetchImpl = fetch) {
  if (!idToken || !channelId) throw new Error('LINE login configuration is incomplete');

  const body = new URLSearchParams({ id_token: idToken, client_id: channelId });
  const response = await fetchImpl('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await response.json();

  if (!response.ok) throw new Error(payload.error_description || 'LINE ID token verification failed');
  if (payload.aud !== channelId) throw new Error('LINE ID token audience mismatch');
  if (!payload.sub) throw new Error('LINE ID token has no user identifier');
  if (Number(payload.exp) * 1000 <= Date.now()) throw new Error('LINE ID token has expired');

  return {
    userId: payload.sub,
    displayName: payload.name ?? '',
    pictureUrl: payload.picture ?? '',
  };
}

export async function replyLineMessage(replyToken, messages, accessToken, fetchImpl = fetch) {
  if (!replyToken || !accessToken || !messages.length) return false;
  const response = await fetchImpl('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!response.ok) throw new Error(`LINE reply failed with status ${response.status}`);
  return true;
}
