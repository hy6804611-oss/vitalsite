const http = require('http');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const tls = require('tls');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'public')) ? path.join(__dirname, 'public') : __dirname;
const BLOCKED = ['server.js', 'package.json'];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 600000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 15;
}
setInterval(() => hits.clear(), 3600000);

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
      headers: { 'User-Agent': 'Vitalsite-Scanner/0.3' }
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

async function sslInfo(hostname, port) {
  const addrs = await dns.lookup(hostname, { all: true });
  if (addrs.some(a => isPrivateIp(a.address))) throw new Error('private');
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: addrs[0].address, port: port, servername: hostname, timeout: 8000 }, () => {
      const cert = socket.getPeerCertificate();
      const info = { validTo: cert.valid_to, authorized: socket.authorized, reason: socket.authorizationError };
      socket.end();
      resolve(info);
    });
    socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
    socket.on('error', reject);
  });
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
  const check = (id, name, status, detail) => {
    checks.push({ id, name, status, detail });
    if (status === 'fail') score -= 15;
    if (status === 'warn') score -= 5;
  };

  check('online', 'Website is online', res.status < 400 ? 'pass' : 'fail', 'Status code: ' + res.status);
  check('speed', 'Response speed', ms < 800 ? 'pass' : ms < 2000 ? 'warn' : 'fail', ms + ' ms to respond');
  check('https', 'Uses HTTPS (secure connection)', finalUrl.protocol === 'https:' ? 'pass' : 'fail',
    finalUrl.protocol === 'https:' ? 'Connection is encrypted' : 'Site loads without encryption');

  if (finalUrl.protocol === 'https:' && !net.isIP(finalUrl.hostname)) {
    try {
      const s = await sslInfo(finalUrl.hostname, Number(finalUrl.port) || 443);
      const days = Math.floor((new Date(s.validTo).getTime() - Date.now()) / 86400000);
      if (!s.authorized || days < 0) {
        check('ssl', 'SSL certificate', 'fail', s.reason ? 'Problem: ' + s.reason : 'Certificate expired');
      } else if (days < 30) {
        check('ssl', 'SSL certificate', 'warn', 'Expires in ' + days + ' days');
      } else {
        check('ssl', 'SSL certificate', 'pass', 'Valid. Expires in ' + days + ' days');
      }
    } catch (e) {
      check('ssl', 'SSL certificate', 'warn', 'Could not read the certificate');
    }
  }

  const headers = [
    ['strict-transport-security', 'HSTS', 'hsts'],
    ['content-security-policy', 'Content Security Policy', 'csp'],
    ['x-frame-options', 'Clickjacking protection', 'xfo'],
    ['x-content-type-options', 'MIME sniffing protection', 'xcto'],
    ['referrer-policy', 'Referrer policy', 'referrer']
  ];
  for (const [h, label, id] of headers) {
    const has = res.headers.has(h);
    check(id, 'Security header: ' + label, has ? 'pass' : 'warn', has ? 'Present' : 'Missing header "' + h + '"');
  }

  if (html) {
    const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
    check('viewport', 'Mobile-friendly setup', viewport ? 'pass' : 'warn',
      viewport ? 'Viewport tag found' : 'No viewport meta tag. The page may look bad on phones.');

    const title = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
    check('title', 'Page title', title ? 'pass' : 'warn', title ? title[1].trim() : 'No <title> found');

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
    check('links', 'Broken links (first 20 checked)', broken.length === 0 ? 'pass' : 'fail',
      broken.length === 0 ? 'No broken links found among ' + links.size : broken.join('\n'));
  }

  return { url: finalUrl.href, status: res.status, responseMs: ms, score: Math.max(0, score), checks };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  const reqUrl = new URL(req.url, 'http://localhost');

  if (reqUrl.pathname === '/api/check') {
    res.setHeader('Content-Type', 'application/json');
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (limited(ip)) {
      res.statusCode = 429;
      return res.end(JSON.stringify({ error: 'Too many scans. Please wait a few minutes and try again.' }));
    }
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