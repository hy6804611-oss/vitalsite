const http = require('http');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'public')) ? path.join(__dirname, 'public') : __dirname; const BLOCKED = ['server.js', 'package.json'];
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    return l === '::1' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') ||
      l.startsWith('::ffff:127.') || l.startsWith('::ffff:10.') || l.startsWith('::ffff:192.168.');
  }
  const p = ip.split('.').map(Number);
  return p[0] === 10 || p[0] === 127 || p[0] === 0 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168);
}

async function safeUrl(input) {
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(input) ? input : 'https://' + input);
  } catch {
    throw new Error('That does not look like a valid website address.');
  }
  if (!['http:', 'https:'].includes(u.protocol)) {
    throw new Error('Only http and https websites are allowed.');
  }
  let addrs;
  try {
    addrs = await dns.lookup(u.hostname, { all: true });
  } catch {
    throw new Error('Could not find that website. Check the spelling.');
  }
  if (addrs.some(a => isPrivateIp(a.address))) {
    throw new Error('Private or local addresses are not allowed.');
  }
  return u;
}

async function fetchSafe(url, method = 'GET', hops = 0) {
  const u = await safeUrl(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(u, {
      method,
      redirect: 'manual',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Vitalsite-Scanner/0.1' }
    });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc && hops < 5) {
      res.body && res.body.cancel().catch(() => {});
      return fetchSafe(new URL(loc, u).href, method, hops + 1);
    }
    return { res, finalUrl: u.href };
  } finally {
    clearTimeout(timer);
  }
}

function friendly(err) {
  if (err.name === 'AbortError') return 'The website took longer than 10 seconds to respond.';
  if (err.message === 'fetch failed') return 'Could not connect. The website may be down or blocking us.';
  return err.message;
}

async function scan(input) {
  const start = Date.now();
  let result;
  try {
    result = await fetchSafe(input);
  } catch (err) {
    throw new Error(friendly(err));
  }
  const ms = Date.now() - start;
  const res = result.res;
  const finalUrl = new URL(result.finalUrl);
  const type = res.headers.get('content-type') || '';
  let html = '';
  if (type.includes('text/html')) html = (await res.text()).slice(0, 500000);

  const checks = [];
  let score = 100;
  const check = (name, status, detail) => {
    checks.push({ name, status, detail });
    if (status === 'fail') score -= 15;
    if (status === 'warn') score -= 5;
  };

  check('Website is online', res.status < 400 ? 'pass' : 'fail', 'Status code: ' + res.status);

  check('Response speed', ms < 800 ? 'pass' : ms < 2000 ? 'warn' : 'fail', ms + ' ms to respond');

  check('Uses HTTPS (secure connection)', finalUrl.protocol === 'https:' ? 'pass' : 'fail',
    finalUrl.protocol === 'https:' ? 'Connection is encrypted' : 'Site loads without encryption');

  const headers = [
    ['strict-transport-security', 'HSTS'],
    ['content-security-policy', 'Content Security Policy'],
    ['x-frame-options', 'Clickjacking protection'],
    ['x-content-type-options', 'MIME sniffing protection'],
    ['referrer-policy', 'Referrer policy']
  ];
  for (const [h, label] of headers) {
    const has = res.headers.has(h);
    check('Security header: ' + label, has ? 'pass' : 'warn', has ? 'Present' : 'Missing header "' + h + '"');
  }

  if (html) {
    const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
    check('Mobile-friendly setup', viewport ? 'pass' : 'warn',
      viewport ? 'Viewport tag found' : 'No viewport meta tag. The page may look bad on phones.');

    const title = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
    check('Page title', title ? 'pass' : 'warn', title ? title[1].trim() : 'No <title> found');

    const links = new Set();
    const re = /href\s*=\s*["']([^"'#][^"']*)["']/gi;
    let m;
    while ((m = re.exec(html)) && links.size < 20) {
      try {
        const u = new URL(m[1], finalUrl);
        if (u.protocol === 'http:' || u.protocol === 'https:') links.add(u.href);
      } catch {}
    }
    const broken = [];
    await Promise.all([...links].map(async link => {
      try {
        let r = (await fetchSafe(link, 'HEAD')).res;
        if (r.status >= 400) r = (await fetchSafe(link, 'GET')).res;
        if (r.status >= 400) broken.push(link + ' (' + r.status + ')');
        r.body && r.body.cancel().catch(() => {});
      } catch {
        broken.push(link + ' (no response)');
      }
    }));
    check('Broken links (first 20 checked)', broken.length === 0 ? 'pass' : 'fail',
      broken.length === 0 ? 'No broken links found among ' + links.size : broken.join('\n'));
  }

  return { url: finalUrl.href, status: res.status, responseMs: ms, score: Math.max(0, score), checks };
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, 'http://localhost');

  if (reqUrl.pathname === '/api/check') {
    res.setHeader('Content-Type', 'application/json');
    try {
      const target = (reqUrl.searchParams.get('url') || '').trim();
      if (!target) throw new Error('Please enter a website address.');
      res.end(JSON.stringify(await scan(target)));
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  const file = reqUrl.pathname === '/' ? '/index.html' : reqUrl.pathname;
  const full = path.normalize(path.join(PUBLIC_DIR, file));
  if (!full.startsWith(PUBLIC_DIR) || BLOCKED.includes(path.basename(full).toLowerCase())) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.statusCode = 404;
      return res.end('Not found');
    }
    res.setHeader('Content-Type', TYPES[path.extname(full)] || 'text/plain');
    res.end(data);
  });
});

server.listen(PORT, () => console.log('Vitalsite is running at http://localhost:' + PORT));