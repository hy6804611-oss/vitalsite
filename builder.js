const PREMIUM_UNLOCKED = false;

const $ = (id) => document.getElementById(id);
const codeBox = $('code');
const frame = $('preview');
const errBox = $('errors');
let lastHtml = '';
let lastName = 'app';

const EXAMPLE = [
  '# This is a YusufLang app. Change the words and watch it update.',
  'app "Kemi Shop"',
  'theme dark',
  'accent "#38bdf8"',
  '',
  'screen Home',
  'title "Kemi Shop"',
  'text "Fresh fashion, fast delivery"',
  'card "New arrivals" "Shoes, bags and watches"',
  'button "See products" goto Products',
  'button "Contact us" goto Contact',
  '',
  'screen Products',
  'title "Products"',
  'list "Sneakers - $20", "Handbag - $15", "Watch - $30"',
  'button "Back home" goto Home',
  '',
  'screen Contact',
  'title "Contact us"',
  'input "Your name"',
  'input "Your phone number"',
  'button "Send" goto Home'
].join('\n');

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function isColor(v) { return /^#[0-9a-fA-F]{3,8}$/.test(v); }
function isUrl(v) { return /^https?:\/\/[^\s"<>]+$/i.test(v); }

function parseLine(line) {
  const m = /^([A-Za-z]+)\s*(.*)$/.exec(line);
  if (!m) return null;
  const rest = m[2].trim();
  const args = [];
  const re = /"([^"]*)"/g;
  let q;
  while ((q = re.exec(rest))) args.push(q[1]);
  const tail = rest.replace(/"[^"]*"/g, ' ').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  return { cmd: m[1].toLowerCase(), args: args, tail: tail };
}

function renderItem(it) {
  switch (it.t) {
    case 'title': return '<h1>' + esc(it.a) + '</h1>';
    case 'text': return '<p>' + esc(it.a) + '</p>';
    case 'input': return '<input placeholder="' + esc(it.a) + '">';
    case 'button': return '<button' + (it.go ? ' data-go="' + esc(it.go) + '"' : '') + '>' + esc(it.a) + '</button>';
    case 'link': return '<a class="lnk" href="' + esc(it.u) + '" target="_blank" rel="noopener">' + esc(it.a) + '</a>';
    case 'image': return '<img src="' + esc(it.a) + '" alt="">';
    case 'list': return '<ul>' + it.a.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';
    case 'card': return '<div class="card"><b>' + esc(it.a) + '</b><p>' + esc(it.b) + '</p></div>';
    case 'divider': return '<hr>';
  }
  return '';
}

function build(code) {
  const app = { name: 'My App', theme: 'dark', accent: '#38bdf8', bg: null };
  const screens = [];
  const gotos = [];
  const errors = [];
  let cur = null;

  function ensure() {
    if (!cur) { cur = { name: 'Home', items: [] }; screens.push(cur); }
    return cur;
  }

  code.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.charAt(0) === '#') return;
    const n = i + 1;
    const p = parseLine(line);
    if (!p) { errors.push('Line ' + n + ': cannot understand: ' + line); return; }
    const cmd = p.cmd, args = p.args, tail = p.tail;
    const bad = (msg) => errors.push('Line ' + n + ': ' + msg);
    const need = (count) => {
      if (args.length < count) { bad('"' + cmd + '" needs ' + count + ' piece(s) of text in quotes, like: ' + cmd + ' "Hello"'); return false; }
      return true;
    };
    const noTail = () => {
      if (tail) { bad('I did not understand "' + tail + '" after ' + cmd); return false; }
      return true;
    };

    switch (cmd) {
      case 'app':
        if (need(1) && noTail()) app.name = args[0];
        break;
      case 'theme':
        if (tail.toLowerCase() === 'dark' || tail.toLowerCase() === 'light') app.theme = tail.toLowerCase();
        else bad('theme must be dark or light');
        break;
      case 'accent':
      case 'color':
        if (need(1)) { if (isColor(args[0])) app.accent = args[0]; else bad('"' + args[0] + '" is not a color like #38bdf8'); }
        break;
      case 'background':
        if (need(1)) { if (isColor(args[0])) app.bg = args[0]; else bad('"' + args[0] + '" is not a color like #0f172a'); }
        break;
      case 'screen':
        if (args.length === 0 && /^[A-Za-z0-9_]+$/.test(tail)) {
          if (screens.some(s => s.name === tail)) bad('screen ' + tail + ' already exists');
          else { cur = { name: tail, items: [] }; screens.push(cur); }
        } else bad('screen needs a name with letters or numbers only, like: screen Home');
        break;
      case 'title':
      case 'text':
      case 'input':
        if (need(1) && noTail()) ensure().items.push({ t: cmd, a: args[0] });
        break;
      case 'button': {
        if (!need(1)) break;
        let go = null;
        if (tail) {
          const g = /^goto\s+([A-Za-z0-9_]+)$/i.exec(tail);
          if (g) { go = g[1]; gotos.push({ n: n, name: go }); }
          else { bad('after the button text use: goto ScreenName'); break; }
        }
        ensure().items.push({ t: 'button', a: args[0], go: go });
        break;
      }
      case 'link':
        if (need(2) && noTail()) {
          if (isUrl(args[1])) ensure().items.push({ t: 'link', a: args[0], u: args[1] });
          else bad('the link address must start with http:// or https://');
        }
        break;
      case 'image':
        if (need(1) && noTail()) {
          if (isUrl(args[0])) ensure().items.push({ t: 'image', a: args[0] });
          else bad('the image address must start with http:// or https://');
        }
        break;
      case 'list':
        if (need(1)) ensure().items.push({ t: 'list', a: args });
        break;
      case 'card':
        if (need(2) && noTail()) ensure().items.push({ t: 'card', a: args[0], b: args[1] });
        break;
      case 'divider':
        if (noTail()) ensure().items.push({ t: 'divider' });
        break;
      default:
        bad('unknown command "' + cmd + '"');
    }
  });

  gotos.forEach(g => {
    if (!screens.some(s => s.name === g.name)) errors.push('Line ' + g.n + ': screen "' + g.name + '" does not exist. Add: screen ' + g.name);
  });

  const dark = app.theme === 'dark';
  const bg = app.bg || (dark ? '#0f172a' : '#f8fafc');
  const fg = dark ? '#ffffff' : '#0f172a';
  const field = dark ? 'rgba(255,255,255,0.1)' : '#ffffff';
  const border = dark ? '#475569' : '#cbd5e1';
  const panel = dark ? 'rgba(255,255,255,0.07)' : '#ffffff';
  const hasNav = screens.length > 1;

  const css = 'body{margin:0;font-family:Arial,sans-serif;background:' + bg + ';color:' + fg + ';padding:24px;' + (hasNav ? 'padding-bottom:80px;' : '') + '}' +
    '.name{font-size:0.8rem;opacity:0.6;margin-bottom:16px;}' +
    'h1{color:' + app.accent + ';margin:0 0 10px;}' +
    'p{opacity:0.85;line-height:1.5;}' +
    'ul{padding-left:20px;line-height:1.8;}' +
    'img{max-width:100%;border-radius:10px;margin:8px 0;}' +
    'input{display:block;width:100%;box-sizing:border-box;padding:12px;margin:10px 0;border-radius:8px;border:1px solid ' + border + ';background:' + field + ';color:' + fg + ';font-size:1rem;}' +
    'button{padding:12px 22px;border:0;border-radius:8px;background:' + app.accent + ';color:#0f172a;font-weight:bold;font-size:1rem;margin:6px 6px 0 0;cursor:pointer;}' +
    '.lnk{display:inline-block;margin:6px 0;color:' + app.accent + ';font-weight:bold;}' +
    '.card{padding:14px;margin:10px 0;border-radius:10px;background:' + panel + ';border:1px solid ' + border + ';}' +
    '.card p{margin:6px 0 0;}' +
    'hr{border:0;border-top:1px solid ' + border + ';margin:18px 0;}' +
    'nav{position:fixed;bottom:0;left:0;right:0;display:flex;justify-content:space-around;padding:12px 8px;background:' + (dark ? '#0b1220' : '#e2e8f0') + ';border-top:1px solid ' + border + ';}' +
    'nav a{color:' + fg + ';text-decoration:none;opacity:0.7;font-size:0.9rem;}' +
    'nav a.on{opacity:1;color:' + app.accent + ';font-weight:bold;}';

  let html;
  if (screens.length === 0) {
    html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(app.name) + '</title><style>' + css + '</style></head><body><p>Write your first command on the left.</p></body></html>';
  } else {
    const body = screens.map(s =>
      '<section class="screen" data-screen="' + esc(s.name) + '" style="display:none">' + s.items.map(renderItem).join('') + '</section>'
    ).join('');
    const nav = hasNav ? '<nav>' + screens.map(s => '<a href="#" data-go="' + esc(s.name) + '">' + esc(s.name) + '</a>').join('') + '</nav>' : '';
    const script = '(function(){var s=document.querySelectorAll(".screen");var a=document.querySelectorAll("nav a");' +
      'function show(n){for(var i=0;i<s.length;i++){s[i].style.display=s[i].getAttribute("data-screen")===n?"block":"none";}' +
      'for(var j=0;j<a.length;j++){a[j].className=a[j].getAttribute("data-go")===n?"on":"";}window.scrollTo(0,0);}' +
      'document.addEventListener("click",function(e){var t=e.target;while(t&&t!==document){if(t.getAttribute&&t.getAttribute("data-go")){e.preventDefault();show(t.getAttribute("data-go"));return;}t=t.parentNode;}});' +
      'show(' + JSON.stringify(screens[0].name) + ');})();';
    html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(app.name) + '</title><style>' + css + '</style></head><body><div class="name">' + esc(app.name) + '</div>' + body + nav + '<script>' + script + '</scr' + 'ipt></body></html>';
  }

  return { html: html, errors: errors, name: app.name };
}

function run() {
  const r = build(codeBox.value);
  lastHtml = r.html;
  lastName = r.name;
  frame.srcdoc = r.html;
  if (r.errors.length) {
    errBox.textContent = r.errors.join('\n');
    errBox.classList.remove('hidden');
  } else {
    errBox.classList.add('hidden');
  }
  try { localStorage.setItem('yl_code', codeBox.value); } catch (e) {}
}

$('reset-btn').addEventListener('click', () => {
  codeBox.value = EXAMPLE;
  run();
});

$('export-btn').addEventListener('click', () => {
  if (!PREMIUM_UNLOCKED) {
    $('lock-msg').classList.remove('hidden');
    return;
  }
  const blob = new Blob([lastHtml], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (lastName || 'app').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.html';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
});

codeBox.addEventListener('input', run);

let saved = null;
try { saved = localStorage.getItem('yl_code'); } catch (e) {}
codeBox.value = saved || EXAMPLE;
run();

const contactEmail = String(window.VITALSITE_EMAIL || '').trim();
if (contactEmail) {
  $('contact-link').href = 'mailto:' + contactEmail;
  $('contact-link').textContent = 'Email ' + contactEmail;
  $('contact').classList.remove('hidden');
}