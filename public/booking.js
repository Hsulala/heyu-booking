const loginTitle = document.querySelector('#login-title');
const loginMessage = document.querySelector('#login-message');
const profileAvatar = document.querySelector('#profile-avatar');
const form = document.querySelector('#customer-booking-form');
const successCard = document.querySelector('#success-card');
const successSummary = document.querySelector('#success-summary');

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

    const idToken = window.liff.getIDToken();
    if (!idToken) throw new Error('LIFF 必須啟用 openid 權限');

    const authResponse = await fetch('/api/auth/line', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
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
window.addEventListener('load', initializeLine);

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  const party = values.partySize === '2' ? '雙人' : '單人';
  successSummary.textContent = `${values.date} ${values.time}・${party}・${values.service}`;
  form.hidden = true;
  successCard.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

document.querySelector('#new-booking').addEventListener('click', () => {
  successCard.hidden = true;
  form.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
