const loginTitle = document.querySelector('#login-title');
const loginMessage = document.querySelector('#login-message');
const profileAvatar = document.querySelector('#profile-avatar');
const form = document.querySelector('#customer-booking-form');
const successCard = document.querySelector('#success-card');
const successSummary = document.querySelector('#success-summary');
const submitButton = form.querySelector('.submit-button');
let lineIdToken = '';

function setSelectOptions(select, values, emptyOption = null) {
  const options = [];
  if (emptyOption) options.push(new Option(emptyOption.label, emptyOption.value));
  values.forEach((value) => options.push(new Option(value, value)));
  select.replaceChildren(...options);
}

async function loadBookingOptions() {
  const response = await fetch('/api/booking-options', { cache: 'no-store' });
  if (!response.ok) return;
  const options = await response.json();
  const serviceSelect = form.elements.service;
  const therapistSelect = form.elements.therapist;
  if (options.services?.length) setSelectOptions(serviceSelect, options.services);
  const refreshTherapists = () => {
    const entries = Object.entries(options.therapists ?? {});
    const hasAssignments = entries.some(([, skills]) => skills.length);
    const available = entries.filter(([, skills]) => !hasAssignments || skills.includes(serviceSelect.value)).map(([name]) => name);
    const fallback = entries.length ? entries.map(([name]) => name) : ['小君', 'Amy', 'Kelly'];
    const names = hasAssignments ? available : fallback;
    setSelectOptions(therapistSelect, names, { label: '不指定', value: '' });
  };
  serviceSelect.addEventListener('change', refreshTherapists);
  refreshTherapists();
}

function setDefaultDate() {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  form.elements.date.min = localDate;
  form.elements.date.value = localDate;
  form.elements.time.value = '10:00';
}

function showLoginError(message) {
  loginTitle.textContent = 'LINE 連接尚未完成';
  loginMessage.textContent = message;
}

async function initializeLine() {
  try {
    const configResponse = await fetch('/api/config', { cache: 'no-store' });
    const config = await configResponse.json();
    if (!config.liffId) throw new Error('系統尚未設定 LIFF ID');
    if (!window.liff) throw new Error('無法載入 LINE LIFF SDK');

    await window.liff.init({ liffId: config.liffId, withLoginOnExternalBrowser: true });
    if (!window.liff.isLoggedIn()) {
      window.liff.login();
      return;
    }

    lineIdToken = window.liff.getIDToken();
    if (!lineIdToken) throw new Error('LIFF 必須啟用 openid 權限');

    const authResponse = await fetch('/api/auth/line', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: lineIdToken }),
    });
    const auth = await authResponse.json();
    if (!authResponse.ok || !auth.authenticated) throw new Error(auth.error || 'LINE 登入驗證失敗');

    loginTitle.textContent = auth.profile.displayName
      ? `${auth.profile.displayName}，您好`
      : 'LINE 身分已驗證';
    loginMessage.textContent = '此頁已透過禾域的後端確認 LINE 身分。';
    if (auth.profile.displayName) form.elements.name.value = auth.profile.displayName;
    if (auth.profile.pictureUrl) {
      const image = document.createElement('img');
      image.src = auth.profile.pictureUrl;
      image.alt = '';
      profileAvatar.replaceChildren(image);
    } else {
      profileAvatar.textContent = auth.profile.displayName?.slice(0, 1) || '和';
    }
    form.hidden = false;
  } catch (error) {
    showLoginError(error.message);
  }
}

setDefaultDate();
window.addEventListener('load', () => Promise.all([initializeLine(), loadBookingOptions()]));

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  submitButton.disabled = true;
  submitButton.textContent = '正在送出…';
  try {
    const response = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...values, idToken: lineIdToken }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '預約送出失敗');
    const party = values.partySize === '2' ? '雙人' : '單人';
    const notification = result.lineNotification
      ? 'LINE 對話中也已傳送收件通知。'
      : '預約已收到，但 LINE 通知暫時傳送失敗，店家仍可在後台查看。';
    successSummary.textContent = `${values.date} ${values.time}・${party}・${values.service}。${notification}`;
    form.hidden = true;
    successCard.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    window.alert(error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = '送出預約需求';
  }
});

document.querySelector('#new-booking').addEventListener('click', () => {
  successCard.hidden = true;
  form.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
