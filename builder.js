const codeBox = document.getElementById('code');
const frame = document.getElementById('preview');
const errBox = document.getElementById('errors');

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function isColor(v) {
  return /^#[0-9a-fA-F]{3,8}$/.test(v);
}

function build(code) {
  const app = { name: 'My App', bg: '#0f172a', accent: '#38bdf8', body: [] };
  const errors = [];
  const needsText = ['app', 'background', 'accent', 'title', 'text', 'button', 'input'];

  code.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const n = i + 1;
    const m = /^([A-Za-z]+)(?:\s+"([^"]*)")?$/.exec(line);
    if (!m) {
      errors.push('Line ' + n + ': cannot understand: ' + line);
      return;
    }
    const cmd = m[1].toLowerCase();
    const arg = m[2];
    if (needsText.includes(cmd) && arg === undefined) {
      errors.push('Line ' + n + ': "' + cmd + '" needs text in quotes, like ' + cmd + ' "Hello"');
      return;
    }
    switch (cmd) {
      case 'app': app.name = arg; break;
      case 'background':
        if (isColor(arg)) app.bg = arg; else errors.push('Line ' + n + ': "' + arg + '" is not a color like #0f172a');
        break;
      case 'accent':
        if (isColor(arg)) app.accent = arg; else errors.push('Line ' + n + ': "' + arg + '" is not a color like #38bdf8');
        break;
      case 'title': app.body.push('<h1>' + esc(arg) + '</h1>'); break;
      case 'text': app.body.push('<p>' + esc(arg) + '</p>'); break;
      case 'input': app.body.push('<input placeholder="' + esc(arg) + '">'); break;
      case 'button': app.body.push('<button>' + esc(arg) + '</button>'); break;
      case 'divider': app.body.push('<hr>'); break;
      default: errors.push('Line ' + n + ': unknown command "' + cmd + '"');
    }
  });

  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(app.name) + '</title><style>' +
    'body{margin:0;font-family:Arial,sans-serif;background:' + app.bg + ';color:#fff;padding:24px;}' +
    '.name{font-size:0.8rem;opacity:0.6;margin-bottom:16px;}' +
    'h1{color:' + app.accent + ';margin:0 0 10px;}' +
    'p{opacity:0.85;}' +
    'input{display:block;width:100%;padding:12px;margin:10px 0;border-radius:8px;border:1px solid #475569;background:#ffffff18;color:#fff;font-size:1rem;}' +
    'button{padding:12px 22px;border:0;border-radius:8px;background:' + app.accent + ';color:#0f172a;font-weight:bold;font-size:1rem;margin-top:6px;}' +
    'hr{border:0;border-top:1px solid #ffffff30;margin:18px 0;}' +
    '</style></head><body><div class="name">' + esc(app.name) + '</div>' + app.body.join('') + '</body></html>';

  return { html: html, errors: errors };
}

function run() {
  const r = build(codeBox.value);
  frame.srcdoc = r.html;
  if (r.errors.length) {
    errBox.textContent = r.errors.join('\n');
    errBox.classList.remove('hidden');
  } else {
    errBox.classList.add('hidden');
  }
}

codeBox.addEventListener('input', run);
run();