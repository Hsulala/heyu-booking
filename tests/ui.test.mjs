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

test('admin exposes booking assignment and configurable buffer information', async () => {
  const [html, js] = await Promise.all([readFile(files.html, 'utf8'), readFile(files.js, 'utf8')]);
  assert.match(html, /稍後指派/);
  assert.match(js, /緩衝分鐘/);
  assert.match(html, /雙人/);
});

test('prototype supports phone-safe layout and reduced motion', async () => {
  const [html, css, js] = await Promise.all(Object.values(files).map((file) => readFile(file, 'utf8')));
  assert.match(html, /viewport-fit=cover/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(js, /#member-search/);
});

test('prototype assets also work when index.html is opened directly', async () => {
  const html = await readFile(files.html, 'utf8');
  assert.match(html, /href="\.\/styles\.css"/);
  assert.match(html, /src="\.\/app\.js" defer/);
  assert.doesNotMatch(html, /type="module"/);
});

test('admin has dedicated mobile navigation and desktop sidebar layouts', async () => {
  const [html, css] = await Promise.all([readFile(files.html, 'utf8'), readFile(files.css, 'utf8')]);
  assert.match(html, /<p class="store-name">禾域<\/p>/);
  assert.doesNotMatch(html, /切換分店/);
  assert.match(css, /@media \(min-width: 900px\)/);
  assert.match(css, /padding-left: 240px/);
  assert.match(css, /width: 240px/);
  assert.doesNotMatch(css, /max-width: 430px/);
});

test('brand palette uses milk-tea and coffee colors', async () => {
  const [html, css] = await Promise.all([readFile(files.html, 'utf8'), readFile(files.css, 'utf8')]);
  assert.match(html, /theme-color" content="#f8efe4"/);
  assert.match(css, /--bg: #f8efe4/);
  assert.match(css, /--ink: #4a3427/);
  assert.match(css, /--brand: #9a6a3e/);
  assert.doesNotMatch(css, /--brand: #536c60/);
});

test('admin creates cloud-synced bookings and members through protected APIs', async () => {
  const [html, js] = await Promise.all([readFile(files.html, 'utf8'), readFile(files.js, 'utf8')]);
  assert.match(html, /id="booking-form"/);
  assert.match(html, /id="member-form"/);
  assert.match(html, /同步顯示在所有店家裝置/);
  assert.match(js, /\/api\/admin\/bookings/);
  assert.match(js, /\/api\/admin\/members/);
  assert.doesNotMatch(html, /測試版|操作原型/);
});

test('customer booking entry initializes LIFF and delegates identity verification to the backend', async () => {
  const [html, css, js] = await Promise.all([
    readFile(new URL('../public/booking.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/booking.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/booking.js', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /static\.line-scdn\.net\/liff\/edge\/2\/sdk\.js/);
  assert.match(html, /送出後店家會收到預約需求/);
  assert.match(js, /liff\.init/);
  assert.match(js, /liff\.getIDToken/);
  assert.match(js, /\/api\/auth\/line/);
  assert.match(js, /\/api\/bookings/);
  assert.match(js, /\/api\/booking-options/);
  assert.match(js, /skills\.includes\(serviceSelect\.value\)/);
  assert.doesNotMatch(js, /LINE_.*SECRET|CHANNEL_ACCESS_TOKEN/);
  assert.match(html, /class="form-grid schedule-grid"/);
  assert.match(css, /@media \(max-width: 430px\)/);
  assert.match(css, /\.schedule-grid \{ grid-template-columns: 1fr; \}/);
});

test('admin loads protected LINE booking requests from the backend', async () => {
  const [html, js] = await Promise.all([readFile(files.html, 'utf8'), readFile(files.js, 'utf8')]);
  assert.match(js, /\/api\/admin\/bookings/);
  assert.match(js, /X-Admin-Key/);
  assert.match(js, /待確認/);
  assert.match(js, /\/status/);
  assert.match(html, /data-booking-status="confirmed"/);
  assert.match(html, /data-booking-status="rejected"/);
});

test('desktop sidebar exposes editable operating settings', async () => {
  const [html, css, js] = await Promise.all([readFile(files.html, 'utf8'), readFile(files.css, 'utf8'), readFile(files.js, 'utf8')]);
  for (const setting of ['services', 'therapists', 'hours', 'rewards', 'reminders', 'branches']) {
    assert.match(html, new RegExp(`data-setting="${setting}"`));
  }
  assert.match(css, /desktop-settings-nav/);
  assert.match(js, /setting-form/);
  assert.match(js, /\/api\/admin\/settings/);
  assert.match(js, /therapistSkillMap/);
  assert.match(js, /input type="checkbox" name="skills"/);
  assert.match(js, /updateAdminTherapistOptions/);
});

test('server persists bookings, members and operating settings to the configured volume', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(server, /process\.env\.DATA_FILE/);
  assert.match(server, /saveBookingRequests/);
  assert.match(server, /saveMembers/);
  assert.match(server, /saveOperatingSettings/);
  assert.match(server, /therapistCanServe/);
  assert.match(server, /\/api\/booking-options/);
});

test('customer and admin content uses production-facing language', async () => {
  const [adminHtml, bookingHtml] = await Promise.all([
    readFile(files.html, 'utf8'),
    readFile(new URL('../public/booking.html', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(adminHtml, /測試版|操作原型|測試操作/);
  assert.doesNotMatch(bookingHtml, /流程測試版|測試環境/);
  assert.match(bookingHtml, /LINE 官方預約/);
});
