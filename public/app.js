const screens = [...document.querySelectorAll('[data-screen]')];
const navButtons = [...document.querySelectorAll('[data-nav]')];
const backdrop = document.querySelector('.backdrop');
const sheets = [...document.querySelectorAll('.bottom-sheet')];
const toast = document.querySelector('.toast');

function showScreen(name) {
  screens.forEach((screen) => screen.classList.toggle('is-active', screen.dataset.screen === name));
  navButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.nav === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openSheet(sheet) {
  sheets.forEach((item) => { item.hidden = item !== sheet; });
  backdrop.hidden = false;
  sheet.hidden = false;
  document.body.style.overflow = 'hidden';
  sheet.querySelector('button')?.focus();
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

document.addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.nav) showScreen(target.dataset.nav);
  if (target.dataset.go) showScreen(target.dataset.go);
  if (target.hasAttribute('data-open-create')) openSheet(document.querySelector('#create-sheet'));
  if (target.hasAttribute('data-open-detail')) openSheet(document.querySelector('#detail-sheet'));
  if (target.hasAttribute('data-close-sheet')) closeSheets();
  if (target.dataset.toast) showToast(target.dataset.toast);
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
