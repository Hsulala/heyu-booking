import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { pushLineMessage, replyLineMessage, verifyLineIdToken, verifyWebhookSignature } from '../lib/line.mjs';

test('LINE webhook signatures are verified with the raw request body', () => {
  const body = Buffer.from('{"events":[]}');
  const secret = 'test-secret';
  const signature = createHmac('sha256', secret).update(body).digest('base64');
  assert.equal(verifyWebhookSignature(body, signature, secret), true);
  assert.equal(verifyWebhookSignature(Buffer.from('{"events":[1]}'), signature, secret), false);
});

test('LINE ID tokens are verified against the configured channel', async () => {
  const fakeFetch = async (url, options) => {
    assert.equal(url, 'https://api.line.me/oauth2/v2.1/verify');
    assert.equal(options.body.get('client_id'), '2011805223');
    return new Response(JSON.stringify({
      aud: '2011805223',
      sub: 'U-test-user',
      name: '測試會員',
      picture: 'https://example.com/avatar.png',
      exp: Math.floor(Date.now() / 1000) + 300,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const profile = await verifyLineIdToken('test-id-token', '2011805223', fakeFetch);
  assert.deepEqual(profile, {
    userId: 'U-test-user',
    displayName: '測試會員',
    pictureUrl: 'https://example.com/avatar.png',
  });
});

test('LINE replies never expose the channel token in the request body', async () => {
  const fakeFetch = async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer private-token');
    assert.doesNotMatch(options.body, /private-token/);
    return new Response('', { status: 200 });
  };
  assert.equal(await replyLineMessage('reply-token', [{ type: 'text', text: '預約' }], 'private-token', fakeFetch), true);
});

test('LINE booking confirmations use the push endpoint without exposing the token', async () => {
  const fakeFetch = async (url, options) => {
    assert.equal(url, 'https://api.line.me/v2/bot/message/push');
    assert.equal(options.headers.Authorization, 'Bearer private-token');
    assert.doesNotMatch(options.body, /private-token/);
    assert.deepEqual(JSON.parse(options.body), {
      to: 'U-test-user',
      messages: [{ type: 'text', text: '已收到預約需求' }],
    });
    return new Response('', { status: 200 });
  };
  assert.equal(await pushLineMessage(
    'U-test-user',
    [{ type: 'text', text: '已收到預約需求' }],
    'private-token',
    fakeFetch,
  ), true);
});
