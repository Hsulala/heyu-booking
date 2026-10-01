const screens = [...document.querySelectorAll('[data-screen]')];
const navButtons = [...document.querySelectorAll('[data-nav]')];
const backdrop = document.querySelector('.backdrop');
const sheets = [...document.querySelectorAll('.bottom-sheet')];
const toast = document.querySelector('.toast');
const storageKey = 'heyu-booking-demo-v1';
const adminKeyStorage = 'heyu-admin-key';

function loadDemoState() {
  try {
    return JSON.parse(localStorage.getItem(storageKey)) ?? { bookings: [], members: [] };
  } catch {
    return { bookings: [], members: [] };
  }
}

const demoState = loadDemoState();

function saveDemoState() {
  localStorage.setItem(storageKey, JSON.stringify(demoState));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function showScreen(name) {
  screens.forEach((screen) => screen.classList.toggle('is-active', screen.dataset.screen === name));
  navButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.nav === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (name === 'bookings') loadServerBookings();
}

function openSheet(sheet) {
  sheets.forEach((item) => { item.hidden = item !== sheet; });
  backdrop.hidden = false;
  sheet.hidden = false;
  document.body.style.overflow = 'hidden';
  sheet.querySelector('input, select, button')?.focus();
}

function closeSheets() {
  sheets.forEach((sheet) => { sheet.hidden = true; });
  backdrop.hidden = true;
  document.body.style.overflow = '';
}

let toastTimer;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2200);
}

function renderSavedBookings() {
  document.querySelectorAll('.booking-row.local-entry').forEach((element) => element.remove());
  const timeline = document.querySelector('#booking-timeline');
  demoState.bookings
    .slice()
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
    .forEach((booking) => {
      const row = document.createElement('article');
      row.className = `booking-row local-entry${booking.therapist ? '' : ' attention'}`;
      const party = booking.partySize === '2' ? '雙人' : '單人';
      const teacher = booking.therapist ? `老師：${escapeHtml(booking.therapist)}` : '尚未指派老師';
      row.innerHTML = `
        <time>${escapeHtml(booking.time)}</time><span class="line-dot"></span>
        <button class="booking-card" type="button" data-demo-booking="${escapeHtml(booking.id)}">
          <span class="booking-top"><strong>${escapeHtml(booking.customer)}</strong><span class="status ${booking.therapist ? 'status-ready' : 'status-alert'}">${booking.therapist ? '已確認' : '待指派'}</span></span>
          <small>${party}・${escapeHtml(booking.service)}・${escapeHtml(booking.date)}</small><span class="therapist">${teacher}</span>
        </button>`;
      timeline.append(row);
    });
}

function renderServerBookings(bookings) {
  document.querySelectorAll('.booking-row.remote-entry').forEach((element) => element.remove());
  const timeline = document.querySelector('#booking-timeline');
  bookings
    .slice()
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
    .forEach((booking) => {
      const row = document.createElement('article');
      row.className = 'booking-row remote-entry attention';
      const party = booking.partySize === '2' ? '雙人' : '單人';
      const teacher = booking.therapist ? `指定老師：${escapeHtml(booking.therapist)}` : '老師：不指定・待店家確認';
      row.innerHTML = `
        <time>${escapeHtml(booking.time)}</time><span class="line-dot"></span>
        <button class="booking-card" type="button" data-toast="${escapeHtml(booking.phone)}${booking.note ? `・${escapeHtml(booking.note)}` : ''}">
          <span class="booking-top"><strong>${escapeHtml(booking.customer)}</strong><span class="status status-alert">LINE 新預約</span></span>
          <small>${party}・${escapeHtml(booking.service)}・${escapeHtml(booking.date)}</small><span class="therapist">${teacher}</span>
        </button>`;
      timeline.prepend(row);
    });
}

let loadingServerBookings = false;
async function loadServerBookings(promptForKey = true) {
  if (loadingServerBookings) return;
  let adminKey = sessionStorage.getItem(adminKeyStorage);
  if (!adminKey) {
    if (!promptForKey) return;
    adminKey = window.prompt('請輸入 Railway 設定的後台存取碼');
    if (!adminKey) return;
    sessionStorage.setItem(adminKeyStorage, adminKey);
  }
  loadingServerBookings = true;
  try {
    const response = await fetch('/api/admin/bookings', {
      cache: 'no-store',
      headers: { 'X-Admin-Key': adminKey },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '無法讀取預約');
    renderServerBookings(result.bookings);
  } catch (error) {
    if (/存取碼/.test(error.message)) sessionStorage.removeItem(adminKeyStorage);
    showToast(error.message);
  } finally {
    loadingServerBookings = false;
  }
}

function renderSavedMembers() {
  document.querySelectorAll('.member-card.local-entry').forEach((element) => element.remove());
  const list = document.querySelector('#member-list');
  demoState.members.forEach((member) => {
    const button = document.createElement('button');
    button.className = 'member-card card local-entry';
    button.type = 'button';
    button.dataset.name = `${member.name} ${member.phone}`;
    button.innerHTML = `<span class="member-avatar">${escapeHtml(member.name.slice(0, 1))}</span><span><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(member.phone || '未填手機')}</small><em>測試會員・尚未綁定 LINE</em></span><span class="chevron">›</span>`;
    list.append(button);
  });
}

function setDefaultBookingDate() {
  const form = document.querySelector('#booking-form');
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  form.elements.date.value = localDate;
  form.elements.time.value = '10:00';
}

const today = new Intl.DateTimeFormat('zh-TW', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
document.querySelector('#today-label').textContent = today;
setDefaultBookingDate();
renderSavedBookings();
renderSavedMembers();

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && document.querySelector('[data-screen="bookings"]').classList.contains('is-active')) {
    loadServerBookings(false);
  }
});
setInterval(() => {
  if (!document.hidden && document.querySelector('[data-screen="bookings"]').classList.contains('is-active')) {
    loadServerBookings(false);
  }
}, 20_000);

document.addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.nav) showScreen(target.dataset.nav);
  if (target.dataset.go) showScreen(target.dataset.go);
  if (target.hasAttribute('data-open-create')) openSheet(document.querySelector('#create-sheet'));
  if (target.hasAttribute('data-open-booking-form')) openSheet(document.querySelector('#booking-form-sheet'));
  if (target.hasAttribute('data-open-member-form')) openSheet(document.querySelector('#member-form-sheet'));
  if (target.hasAttribute('data-open-detail')) openSheet(document.querySelector('#detail-sheet'));
  if (target.hasAttribute('data-close-sheet')) closeSheets();
  if (target.dataset.toast) showToast(target.dataset.toast);
  if (target.dataset.demoBooking) {
    const booking = demoState.bookings.find((item) => item.id === target.dataset.demoBooking);
    if (booking) showToast(`${booking.customer}・${booking.date} ${booking.time}`);
  }
  if (target.hasAttribute('data-reset-demo')) {
    localStorage.removeItem(storageKey);
    demoState.bookings = [];
    demoState.members = [];
    renderSavedBookings();
    renderSavedMembers();
    showToast('本機測試資料已重設');
  }
});

backdrop.addEventListener('click', closeSheets);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeSheets(); });

document.querySelectorAll('.date-strip button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.date-strip button').forEach((item) => item.classList.remove('is-selected'));
    button.classList.add('is-selected');
    if (!button.textContent.includes('27')) showToast('此日期目前沒有示範預約');
  });
});

document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach((item) => item.classList.remove('is-selected'));
    chip.classList.add('is-selected');
  });
});

const memberSearch = document.querySelector('#member-search');
memberSearch.addEventListener('input', () => {
  const query = memberSearch.value.trim().toLowerCase();
  const members = [...document.querySelectorAll('.member-card')];
  let visible = 0;
  members.forEach((member) => {
    const match = member.dataset.name.toLowerCase().includes(query);
    member.hidden = !match;
    if (match) visible += 1;
  });
  document.querySelector('#member-empty').hidden = visible !== 0;
});

document.querySelector('#booking-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  demoState.bookings.push({ id: crypto.randomUUID(), ...values });
  saveDemoState();
  renderSavedBookings();
  event.currentTarget.reset();
  setDefaultBookingDate();
  closeSheets();
  showScreen('bookings');
  showToast('測試預約已建立');
});

document.querySelector('#member-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  demoState.members.push({ id: crypto.randomUUID(), ...values });
  saveDemoState();
  renderSavedMembers();
  event.currentTarget.reset();
  closeSheets();
  showScreen('members');
  showToast('測試會員已建立');
});
