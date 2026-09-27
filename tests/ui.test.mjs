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
