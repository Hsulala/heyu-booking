import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

const files = {
  html: new URL('../public/index.html', import.meta.url),
  css: new URL('../public/styles.css', import.meta.url),
  js: new URL('../public/app.js', import.meta.url),
};

test('mobile admin contains the four core work areas', async () => {
  const html = await readFile(files.html, 'utf8');
  for (const screen of ['home', 'bookings', 'members', 'more']) {
    assert.match(html, new RegExp(`data-screen="${screen}"`));
    assert.match(html, new RegExp(`data-nav="${screen}"`));
  }
});

test('prototype exposes booking assignment and buffer information', async () => {
  const html = await readFile(files.html, 'utf8');
  assert.match(html, /尚未指派老師/);
  assert.match(html, /緩衝至 11:30/);
  assert.match(html, /雙人/);
});

test('prototype supports phone-safe layout and reduced motion', async () => {
  const [html, css, js] = await Promise.all(Object.values(files).map((file) => readFile(file, 'utf8')));
  assert.match(html, /viewport-fit=cover/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(js, /memberSearch\.addEventListener/);
});

test('prototype assets also work when index.html is opened directly', async () => {
  const html = await readFile(files.html, 'utf8');
  assert.match(html, /href="\.\/styles\.css"/);
  assert.match(html, /src="\.\/app\.js" defer/);
  assert.doesNotMatch(html, /type="module"/);
});

test('in-app and tablet previews keep the mobile navigation flush to the bottom', async () => {
  const [html, css] = await Promise.all([readFile(files.html, 'utf8'), readFile(files.css, 'utf8')]);
  assert.match(html, /<p class="store-name">禾域<\/p>/);
  assert.doesNotMatch(html, /切換分店/);
  assert.match(css, /@media \(min-width: 1100px\)/);
  assert.doesNotMatch(css, /@media \(min-width: 720px\)/);
});

test('brand palette uses milk-tea and coffee colors', async () => {
  const [html, css] = await Promise.all([readFile(files.html, 'utf8'), readFile(files.css, 'utf8')]);
  assert.match(html, /theme-color" content="#f8efe4"/);
  assert.match(css, /--bg: #f8efe4/);
  assert.match(css, /--ink: #4a3427/);
  assert.match(css, /--brand: #9a6a3e/);
  assert.doesNotMatch(css, /--brand: #536c60/);
});

test('owner test build can create local bookings and members without implying production persistence', async () => {
  const [html, js] = await Promise.all([readFile(files.html, 'utf8'), readFile(files.js, 'utf8')]);
  assert.match(html, /id="booking-form"/);
  assert.match(html, /id="member-form"/);
  assert.match(html, /測試版資料只會保存在這台裝置的瀏覽器/);
  assert.match(js, /localStorage\.setItem/);
  assert.match(js, /crypto\.randomUUID/);
  assert.match(js, /data-reset-demo/);
});

test('customer booking entry initializes LIFF and delegates identity verification to the backend', async () => {
  const [html, js] = await Promise.all([
    readFile(new URL('../public/booking.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/booking.js', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /static\.line-scdn\.net\/liff\/edge\/2\/sdk\.js/);
  assert.match(html, /表單內容不會傳送或保存/);
  assert.match(js, /liff\.init/);
  assert.match(js, /liff\.getIDToken/);
  assert.match(js, /\/api\/auth\/line/);
  assert.doesNotMatch(js, /LINE_.*SECRET|CHANNEL_ACCESS_TOKEN/);
});
