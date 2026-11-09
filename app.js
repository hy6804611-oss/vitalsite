const form = document.getElementById('scan-form');
const btn = document.getElementById('btn');
const loading = document.getElementById('loading');
const errorBox = document.getElementById('error');
const result = document.getElementById('result');
const installBtn = document.getElementById('install');

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const icons = { pass: '\u2705', warn: '\u26A0\uFE0F', fail: '\u274C' };

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = document.getElementById('url').value.trim();
  errorBox.classList.add('hidden');
  result.classList.add('hidden');
  loading.classList.remove('hidden');
  btn.disabled = true;

  try {
    const res = await fetch('/api/check?url=' + encodeURIComponent(url));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');

    const scoreEl = document.getElementById('score');
    scoreEl.textContent = data.score;
    scoreEl.style.borderColor = data.score >= 80 ? '#22c55e' : data.score >= 55 ? '#eab308' : '#ef4444';
    document.getElementById('site').textContent = data.url;
    document.getElementById('meta').textContent = 'Status ' + data.status + ' - ' + data.responseMs + ' ms';
    document.getElementById('checks').innerHTML = data.checks.map(c =>
      '<div class="check ' + c.status + '">' +
        '<div class="check-name">' + icons[c.status] + ' ' + esc(c.name) + '</div>' +
        '<div class="check-detail">' + esc(c.detail).replace(/\n/g, '<br>') + '</div>' +
      '</div>'
    ).join('');
    result.classList.remove('hidden');
    result.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.remove('hidden');
  } finally {
    loading.classList.add('hidden');
    btn.disabled = false;
  }
});

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.classList.remove('hidden');
});
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt = null;
  installBtn.classList.add('hidden');
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}