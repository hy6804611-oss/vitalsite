const $ = (id) => document.getElementById(id);
const form = $('scan-form');
const btn = $('btn');
const loading = $('loading');
const errorBox = $('error');
const result = $('result');
const installBtn = $('install');

const icons = { pass: '\u2705', warn: '\u26A0\uFE0F', fail: '\u274C' };

const FIX = {
  online: "Check your hosting dashboard. Your server may be down or the page address may be wrong. Ask your hosting provider for help.",
  speed: "Compress your images, remove scripts you do not use, and use a free CDN like Cloudflare. If it is still slow, your hosting may need an upgrade.",
  https: "Turn on HTTPS. Most hosts give a free certificate. Then make every http:// page redirect to https://.",
  ssl: "Renew your SSL certificate. Most hosts can renew it automatically, so check your hosting panel.",
  hsts: "Add this header on your server: Strict-Transport-Security: max-age=31536000",
  csp: "Add a Content-Security-Policy header to control which scripts can run on your pages. Start simple and test.",
  xfo: "Add this header on your server: X-Frame-Options: SAMEORIGIN. It stops other sites from framing your pages.",
  xcto: "Add this header on your server: X-Content-Type-Options: nosniff",
  referrer: "Add this header on your server: Referrer-Policy: strict-origin-when-cross-origin",
  viewport: "Add this line inside the <head> of your page: <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
  title: "Add a clear <title> inside the <head> so visitors and search engines know what the page is about.",
  links: "Fix or remove the broken links listed above. Open each one in your browser to confirm it works."
};

let last = null;

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function colorFor(score) {
  return score >= 80 ? '#22c55e' : score >= 55 ? '#eab308' : '#ef4444';
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem('vs_history') || '[]'); } catch (e) { return []; }
}

function saveHistory(list) {
  try { localStorage.setItem('vs_history', JSON.stringify(list.slice(0, 10))); } catch (e) {}
}

function renderHistory() {
  const list = loadHistory();
  $('history').classList.toggle('hidden', list.length === 0);
  $('history-list').innerHTML = list.map(h =>
    '<div class="hist"><span class="hist-score" style="border-color:' + colorFor(Number(h.score)) + '">' + esc(h.score) + '</span>' +
    '<span class="hist-url">' + esc(h.url) + '</span><span class="hist-date">' + esc(h.date) + '</span></div>'
  ).join('');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = $('url').value.trim();
  errorBox.classList.add('hidden');
  result.classList.add('hidden');
  loading.classList.remove('hidden');
  btn.disabled = true;

  try {
    const res = await fetch('/api/check?url=' + encodeURIComponent(url));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    last = data;

    const scoreEl = $('score');
    scoreEl.textContent = data.score;
    scoreEl.style.borderColor = colorFor(data.score);
    $('site').textContent = data.url;
    $('meta').textContent = 'Status ' + data.status + ' - ' + data.responseMs + ' ms';
    $('print-date').textContent = new Date().toLocaleString();
    $('checks').innerHTML = data.checks.map(c =>
      '<div class="check ' + c.status + '">' +
        '<div class="check-name">' + icons[c.status] + ' ' + esc(c.name) + '</div>' +
        '<div class="check-detail">' + esc(c.detail).replace(/\n/g, '<br>') + '</div>' +
        (c.status !== 'pass' && FIX[c.id] ? '<div class="check-fix"><b>How to fix:</b> ' + esc(FIX[c.id]) + '</div>' : '') +
      '</div>'
    ).join('');
    result.classList.remove('hidden');
    result.scrollIntoView({ behavior: 'smooth' });

    const list = loadHistory();
    list.unshift({ url: data.url, score: data.score, date: new Date().toLocaleDateString() });
    saveHistory(list);
    renderHistory();
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.remove('hidden');
  } finally {
    loading.classList.add('hidden');
    btn.disabled = false;
  }
});

$('print-btn').addEventListener('click', () => window.print());

$('share-btn').addEventListener('click', () => {
  if (!last) return;
  const text = 'I checked ' + last.url + ' with Vitalsite and it scored ' + last.score + '/100. Check your website free: ' + location.origin;
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
});

$('clear-history').addEventListener('click', () => {
  try { localStorage.removeItem('vs_history'); } catch (e) {}
  renderHistory();
});

async function sha1(text) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

$('pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const box = $('pw-result');
  const pwBtn = $('pw-btn');
  pwBtn.disabled = true;
  box.className = '';
  box.textContent = 'Checking...';
  try {
    const hash = await sha1($('pw').value);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    const res = await fetch('https://api.pwnedpasswords.com/range/' + prefix, { headers: { 'Add-Padding': 'true' } });
    if (!res.ok) throw new Error('Service unavailable');
    const text = await res.text();
    const line = text.split('\n').map(l => l.trim()).find(l => l.split(':')[0] === suffix);
    const count = line ? parseInt(line.split(':')[1], 10) : 0;
    if (count > 0) {
      box.className = 'bad';
      box.textContent = 'This password appeared ' + count.toLocaleString() + ' times in known data leaks. Do not use it. Choose a longer, unique one.';
    } else {
      box.className = 'good';
      box.textContent = 'Not found in known leaks. Still use a long, unique password for every account.';
    }
  } catch (err) {
    box.className = 'bad';
    box.textContent = 'Could not check right now. Please try again later.';
  } finally {
    $('pw').value = '';
    pwBtn.disabled = false;
  }
});

const contactEmail = String(window.VITALSITE_EMAIL || '').trim();
if (contactEmail) {
  $('contact-link').href = 'mailto:' + contactEmail;
  $('contact-link').textContent = 'Email ' + contactEmail;
  $('contact').classList.remove('hidden');
}

renderHistory();

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