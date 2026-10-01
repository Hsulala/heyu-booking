const screens = [...document.querySelectorAll('[data-screen]')];
const navButtons = [...document.querySelectorAll('[data-nav]')];
const backdrop = document.querySelector('.backdrop');
const sheets = [...document.querySelectorAll('.bottom-sheet')];
const toast = document.querySelector('.toast');
let bookings = [], members = [], users = [], currentUser = null, selectedBookingId = '', selectedDate = '', bookingFilter = 'all', toastTimer;
let therapistSkillMap = { 小君: [], Amy: [], Kelly: [] };
const therapistNames = ['小君', 'Amy', 'Kelly'];
const serviceNames = ['身體精油按摩 60 分', '深層舒壓 90 分', '筋膜刀 60 分'];

const settingDefinitions = {
  services: { title: '療程與緩衝時間', fields: [['serviceName', '療程名稱', '身體精油按摩'], ['duration', '服務分鐘', '60'], ['buffer', '緩衝分鐘', '30']] },
  therapists: { title: '老師與可服務項目', fields: [] },
  hours: { title: '營業時間與休假', fields: [['openTime', '開始營業', '10:00'], ['closeTime', '結束營業', '21:00'], ['closedDays', '固定休假', '依店內公告']] },
  rewards: { title: '點數、優惠券與堂數包', fields: [['pointsRate', '每 NT$100 回饋點數', '1'], ['coupon', '目前優惠', '新客體驗優惠'], ['packages', '堂數包', '精油按摩 10 堂']] },
  reminders: { title: '提醒與爽約規則', fields: [['reminderHours', '提前提醒小時', '24'], ['cancelHours', '可取消期限（小時）', '12'], ['noShowRule', '爽約規則', '請與店家聯絡']] },
  branches: { title: '分店管理', fields: [['branchName', '分店名稱', '禾域本店'], ['address', '地址', '請填寫地址'], ['phone', '分店電話', '請填寫電話']] },
};

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]); }
function localDateString(date = new Date()) { return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function applyRoleVisibility() {
  const canManage = ['owner', 'manager'].includes(currentUser?.role);
  document.querySelectorAll('[data-setting]').forEach((element) => { element.hidden = !canManage; });
  document.querySelector('#user-management-button').hidden = currentUser?.role !== 'owner';
  document.querySelector('#create-member-button').hidden = !canManage;
  document.querySelector('#members-nav').hidden = !canManage;
  document.querySelector('.bottom-nav').style.gridTemplateColumns = canManage ? '' : 'repeat(4, 1fr)';
  document.querySelector('#account-name').textContent = `${currentUser?.displayName ?? ''}・${currentUser?.role === 'owner' ? '店主' : currentUser?.role === 'manager' ? '店長' : '員工'}`;
}

function showLogin() { document.querySelector('#app-shell').hidden = true; document.querySelector('#login-screen').hidden = false; }
function showApp() { document.querySelector('#login-screen').hidden = true; document.querySelector('#app-shell').hidden = false; applyRoleVisibility(); }
function showToast(message) { toast.textContent = message; toast.classList.add('is-visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600); }
function openSheet(sheet) { sheets.forEach((item) => { item.hidden = item !== sheet; }); backdrop.hidden = false; sheet.hidden = false; document.body.style.overflow = 'hidden'; sheet.querySelector('input, select, button')?.focus(); }
function closeSheets() { sheets.forEach((sheet) => { sheet.hidden = true; }); backdrop.hidden = true; document.body.style.overflow = ''; }
function showScreen(name) { screens.forEach((screen) => screen.classList.toggle('is-active', screen.dataset.screen === name)); navButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.nav === name)); if (['home', 'bookings', 'members'].includes(name)) syncData(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function statusText(status) { return status === 'confirmed' ? '已確認' : status === 'rejected' ? '已拒絕' : '待確認'; }
function updateAdminTherapistOptions() {
  const form = document.querySelector('#booking-form'), service = form.elements.service.value, select = form.elements.therapist, previous = select.value;
  const hasAssignments = Object.values(therapistSkillMap).some((skills) => skills.length);
  const available = therapistNames.filter((name) => !hasAssignments || (therapistSkillMap[name] ?? []).includes(service));
  select.innerHTML = `<option value="">稍後指派</option>${available.map((name) => `<option>${name}</option>`).join('')}`;
  if (available.includes(previous)) select.value = previous;
}

function buildDateStrip() {
  const today = new Date(); selectedDate ||= localDateString(today);
  document.querySelector('#date-strip').innerHTML = Array.from({ length: 5 }, (_, i) => { const date = new Date(today); date.setDate(today.getDate() + i); const value = localDateString(date); const weekday = i === 0 ? '今天' : new Intl.DateTimeFormat('zh-TW', { weekday: 'short' }).format(date); return `<button class="${value === selectedDate ? 'is-selected' : ''}" type="button" data-date="${value}"><span>${weekday}</span><strong>${date.getDate()}</strong></button>`; }).join('');
  document.querySelector('#booking-date-jump').value = selectedDate;
}

function renderBookings() {
  const visible = bookings.filter((b) => b.date === selectedDate).filter((b) => bookingFilter === 'all' || b.status === bookingFilter).sort((a, b) => a.time.localeCompare(b.time));
  document.querySelector('#booking-timeline').innerHTML = visible.length ? visible.map((b) => `<article class="booking-row remote-entry${b.status === 'pending' ? ' attention' : ''}"><time>${escapeHtml(b.time)}</time><span class="line-dot"></span><button class="booking-card" type="button" data-server-booking="${escapeHtml(b.id)}"><span class="booking-top"><strong>${escapeHtml(b.customer)}</strong><span class="status ${b.status === 'confirmed' ? 'status-ready' : b.status === 'pending' ? 'status-alert' : ''}">${statusText(b.status)}</span></span><small>${b.partySize === '2' ? '雙人' : '單人'}・${escapeHtml(b.service)}</small><span class="therapist">${escapeHtml(b.therapist ? `老師：${b.therapist}` : '老師：尚未指派')}</span></button></article>`).join('') : '<p class="empty-state">這一天尚無預約</p>';
}

function renderMembers() {
  document.querySelector('#member-list').innerHTML = members.map((m) => `<button class="member-card card" type="button" data-name="${escapeHtml(`${m.name} ${m.phone}`)}" data-toast="${escapeHtml(m.note || `${m.name}・${m.phone || '未填手機'}`)}"><span class="member-avatar">${escapeHtml(m.name.slice(0, 1))}</span><span><strong>${escapeHtml(m.name)}</strong><small>${escapeHtml(m.phone || '未填手機')}</small><em>雲端會員</em></span><span class="chevron">›</span></button>`).join('');
  document.querySelector('#member-empty').hidden = members.length !== 0;
}

function renderDashboard() {
  const today = localDateString(), todayBookings = bookings.filter((b) => b.date === today && b.status !== 'rejected'), pending = bookings.filter((b) => b.status === 'pending');
  const guests = todayBookings.reduce((sum, b) => sum + Number(b.partySize || 1), 0);
  document.querySelector('#home-summary').textContent = todayBookings.length ? `今天有 ${todayBookings.length} 組客人。` : '今天尚無預約。';
  document.querySelector('#today-booking-count').textContent = todayBookings.length; document.querySelector('#today-guest-count').textContent = `${guests} 位客人`; document.querySelector('#today-pending-count').textContent = pending.length; document.querySelector('#pending-count').textContent = pending.length;
  document.querySelector('#pending-chip').textContent = `待確認 ${pending.length}`;
  const now = new Date().toTimeString().slice(0, 5), next = todayBookings.filter((b) => b.time >= now).sort((a, b) => a.time.localeCompare(b.time))[0];
  document.querySelector('#next-booking-title').textContent = next ? `${next.time}・${next.customer}` : '今日尚無後續預約'; document.querySelector('#next-booking-status').textContent = next ? statusText(next.status) : '行程'; document.querySelector('#next-booking-summary').textContent = next ? `${next.partySize === '2' ? '雙人' : '單人'}・${next.service}・${next.therapist || '尚未指派老師'}` : '新增預約後會顯示在這裡。';
  document.querySelector('#task-list').innerHTML = pending.length ? pending.slice(0, 3).map((b) => `<button class="task-card" type="button" data-server-booking="${escapeHtml(b.id)}"><span class="task-icon urgent">!</span><span><strong>${escapeHtml(b.customer)}等待確認</strong><small>${escapeHtml(b.date)} ${escapeHtml(b.time)}・${escapeHtml(b.service)}</small></span><span class="chevron">›</span></button>`).join('') : '<p class="empty-state">目前沒有待處理預約</p>';
}

async function syncData(ask = true) {
  if (!currentUser) return;
  try { const canManageMembers = ['owner', 'manager'].includes(currentUser.role); const [br, mr, or] = await Promise.all([fetch('/api/admin/bookings', { cache: 'no-store' }), canManageMembers ? fetch('/api/admin/members', { cache: 'no-store' }) : Promise.resolve(null), fetch('/api/booking-options', { cache: 'no-store' })]); const bd = await br.json(), md = mr ? await mr.json() : { members: [] }, od = await or.json(); if (br.status === 401 || mr?.status === 401) { currentUser = null; showLogin(); return; } if (!br.ok) throw new Error(bd.error || '無法同步預約'); if (mr && !mr.ok) throw new Error(md.error || '無法同步會員'); bookings = bd.bookings; members = md.members; therapistSkillMap = { 小君: [], Amy: [], Kelly: [], ...(od.therapists ?? {}) }; updateAdminTherapistOptions(); renderBookings(); renderMembers(); renderDashboard(); } catch (error) { showToast(error.message); }
}

function openBooking(id) {
  const b = bookings.find((item) => item.id === id); if (!b) return; selectedBookingId = id;
  document.querySelector('#detail-title').textContent = `${b.customer}・${b.time}`; document.querySelector('.detail-list').innerHTML = `<div><dt>日期</dt><dd>${escapeHtml(b.date)}</dd></div><div><dt>人數</dt><dd>${b.partySize === '2' ? '雙人' : '單人'}</dd></div><div><dt>療程</dt><dd>${escapeHtml(b.service)}</dd></div><div><dt>老師</dt><dd>${escapeHtml(b.therapist || '尚未指派')}</dd></div><div><dt>手機</dt><dd>${escapeHtml(b.phone || '未填')}</dd></div><div><dt>備註</dt><dd>${escapeHtml(b.note || '無')}</dd></div>`; document.querySelector('#detail-actions').hidden = b.status !== 'pending'; openSheet(document.querySelector('#detail-sheet'));
}

async function updateBookingStatus(status) {
  if (!selectedBookingId) return;
  try { const response = await fetch(`/api/admin/bookings/${encodeURIComponent(selectedBookingId)}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || '更新預約失敗'); closeSheets(); await syncData(false); showToast(`${status === 'confirmed' ? '已確認' : '已拒絕'}預約${result.lineNotification ? '，並已通知客人' : ''}`); } catch (error) { showToast(error.message); }
}

async function openSetting(key) {
  const definition = settingDefinitions[key]; if (!definition || !['owner', 'manager'].includes(currentUser?.role)) return; let settings = {};
  try { const response = await fetch('/api/admin/settings', { cache: 'no-store' }); const result = await response.json(); if (!response.ok) throw new Error(result.error || '無法讀取設定'); settings = result.settings; } catch (error) { showToast(error.message); }
  const saved = settings[key] ?? {}, form = document.querySelector('#setting-form'); form.dataset.setting = key; document.querySelector('#setting-title').textContent = definition.title;
  if (key === 'therapists') {
    therapistSkillMap = { 小君: [], Amy: [], Kelly: [], ...(saved.teachers ?? {}) };
    document.querySelector('#setting-fields').innerHTML = `<label class="field full"><span>選擇老師</span><select id="therapist-setting-select" name="therapist">${therapistNames.map((name) => `<option>${name}</option>`).join('')}</select></label><fieldset class="field full skill-options"><legend>這位老師可服務的療程</legend>${serviceNames.map((service) => `<label class="check-field"><input type="checkbox" name="skills" value="${escapeHtml(service)}" /><span>${escapeHtml(service)}</span></label>`).join('')}</fieldset>`;
    renderTherapistSkills(therapistNames[0]);
  } else {
    document.querySelector('#setting-fields').innerHTML = definition.fields.map(([name, label, fallback]) => `<label class="field full"><span>${label}</span><input name="${name}" value="${escapeHtml(saved[name] ?? fallback)}" required /></label>`).join('');
  }
  document.querySelectorAll('[data-setting]').forEach((button) => button.classList.toggle('is-active', button.dataset.setting === key)); openSheet(document.querySelector('#setting-sheet'));
}

function captureTherapistSkills() {
  const select = document.querySelector('#therapist-setting-select');
  if (!select) return;
  therapistSkillMap[select.value] = [...document.querySelectorAll('#setting-fields input[name="skills"]:checked')].map((input) => input.value);
}

function renderTherapistSkills(name) {
  document.querySelectorAll('#setting-fields input[name="skills"]').forEach((input) => { input.checked = (therapistSkillMap[name] ?? []).includes(input.value); });
}

function setDefaultBookingDate() { const form = document.querySelector('#booking-form'); form.elements.date.value = localDateString(); form.elements.time.value = '10:00'; }
document.querySelector('#today-label').textContent = new Intl.DateTimeFormat('zh-TW', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date()); buildDateStrip(); setDefaultBookingDate();

async function bootstrapAuth() {
  try {
    const response = await fetch('/api/auth/me', { cache: 'no-store' });
    if (!response.ok) return showLogin();
    currentUser = (await response.json()).user;
    showApp();
    await syncData(false);
  } catch { showLogin(); }
}

async function openUsers() {
  if (currentUser?.role !== 'owner') return;
  try {
    const response = await fetch('/api/admin/users', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '無法讀取帳號');
    users = result.users;
    document.querySelector('#user-list').innerHTML = users.map((user) => `<div class="user-row"><span><strong>${escapeHtml(user.displayName)}</strong><small>${escapeHtml(user.username)}・${user.role === 'owner' ? '店主' : user.role === 'manager' ? '店長' : '員工'}・${user.active ? '使用中' : '已停用'}</small></span>${user.id === currentUser.id ? '<small>目前帳號</small>' : `<span class="user-actions"><button type="button" data-user-password="${escapeHtml(user.id)}">重設密碼</button><button type="button" data-user-toggle="${escapeHtml(user.id)}" data-active="${user.active}">${user.active ? '停用' : '啟用'}</button></span>`}</div>`).join('');
    openSheet(document.querySelector('#users-sheet'));
  } catch (error) { showToast(error.message); }
}

bootstrapAuth();

document.addEventListener('click', (event) => {
  const target = event.target.closest('button'); if (!target) return;
  if (target.dataset.nav) showScreen(target.dataset.nav); if (target.dataset.go) showScreen(target.dataset.go);
  if (target.dataset.date) { selectedDate = target.dataset.date; buildDateStrip(); renderBookings(); }
  if (target.classList.contains('chip')) { document.querySelectorAll('.chip').forEach((item) => item.classList.remove('is-selected')); target.classList.add('is-selected'); bookingFilter = target.textContent.includes('待確認') ? 'pending' : target.textContent.includes('已確認') ? 'confirmed' : 'all'; renderBookings(); }
  if (target.hasAttribute('data-open-create')) openSheet(document.querySelector('#create-sheet')); if (target.hasAttribute('data-open-booking-form')) openSheet(document.querySelector('#booking-form-sheet')); if (target.hasAttribute('data-open-member-form')) openSheet(document.querySelector('#member-form-sheet')); if (target.hasAttribute('data-close-sheet')) closeSheets(); if (target.dataset.serverBooking) openBooking(target.dataset.serverBooking); if (target.dataset.bookingStatus) updateBookingStatus(target.dataset.bookingStatus); if (target.dataset.setting) { showScreen('more'); openSetting(target.dataset.setting); } if (target.dataset.toast) showToast(target.dataset.toast);
  if (target.hasAttribute('data-users')) openUsers();
  if (target.dataset.userToggle) updateUser(target.dataset.userToggle, { active: target.dataset.active !== 'true' });
  if (target.dataset.userPassword) resetUserPassword(target.dataset.userPassword);
  if (target.hasAttribute('data-logout')) logout();
});

document.querySelector('#setting-fields').addEventListener('change', (event) => {
  if (event.target.id === 'therapist-setting-select') {
    const previous = event.target.dataset.previous || therapistNames[0];
    const checked = [...document.querySelectorAll('#setting-fields input[name="skills"]:checked')].map((input) => input.value);
    therapistSkillMap[previous] = checked;
    event.target.dataset.previous = event.target.value;
    renderTherapistSkills(event.target.value);
  }
});

backdrop.addEventListener('click', closeSheets); document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeSheets(); }); document.addEventListener('visibilitychange', () => { if (!document.hidden) syncData(false); }); setInterval(() => { if (!document.hidden) syncData(false); }, 30000);
document.querySelector('#booking-date-jump').addEventListener('change', (event) => { selectedDate = event.currentTarget.value; buildDateStrip(); renderBookings(); });
document.querySelector('#booking-form').elements.service.addEventListener('change', updateAdminTherapistOptions);
document.querySelector('#member-search').addEventListener('input', (event) => { const query = event.currentTarget.value.trim().toLowerCase(); let visible = 0; document.querySelectorAll('.member-card').forEach((member) => { const match = member.dataset.name.toLowerCase().includes(query); member.hidden = !match; if (match) visible += 1; }); document.querySelector('#member-empty').hidden = visible !== 0; });

document.querySelector('#booking-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; try { const response = await fetch('/api/admin/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || '建立預約失敗'); form.reset(); setDefaultBookingDate(); closeSheets(); await syncData(false); showScreen('bookings'); showToast('預約已建立並同步'); } catch (error) { showToast(error.message); } });
document.querySelector('#member-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; try { const response = await fetch('/api/admin/members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || '建立會員失敗'); form.reset(); closeSheets(); await syncData(false); showScreen('members'); showToast('會員已建立並同步'); } catch (error) { showToast(error.message); } });
document.querySelector('#setting-form').addEventListener('submit', async (event) => { event.preventDefault(); const settingKey = event.currentTarget.dataset.setting; if (settingKey === 'therapists') captureTherapistSkills(); const values = settingKey === 'therapists' ? { teachers: therapistSkillMap } : Object.fromEntries(new FormData(event.currentTarget)); try { const response = await fetch('/api/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: settingKey, values }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || '設定儲存失敗'); closeSheets(); showToast(`${settingDefinitions[settingKey].title}已同步`); } catch (error) { showToast(error.message); } });

document.querySelector('#admin-login-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; const errorBox = document.querySelector('#login-error'); errorBox.textContent = ''; try { const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || '登入失敗'); currentUser = result.user; form.reset(); showApp(); await syncData(false); } catch (error) { errorBox.textContent = error.message; } });
document.querySelector('#user-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; try { const response = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || '建立帳號失敗'); form.reset(); await openUsers(); showToast('帳號已建立'); } catch (error) { showToast(error.message); } });

async function updateUser(userId, values) { try { const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || '更新帳號失敗'); await openUsers(); showToast('帳號狀態已更新'); } catch (error) { showToast(error.message); } }
async function resetUserPassword(userId) { const password = window.prompt('請輸入至少 8 個字元的新密碼'); if (!password) return; await updateUser(userId, { password }); }
async function logout() { await fetch('/api/auth/logout', { method: 'POST' }); currentUser = null; closeSheets(); showLogin(); }
