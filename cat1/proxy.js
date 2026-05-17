// proxy.js — local CORS proxy
//
// Routes:
//   GET /getWeatherInfo                       -> SafeGuardian weather (GET)
//   GET /getCATInfo?lat=<>&long=<>            -> SafeGuardian CAT info (POST upstream)
//   GET /getWBGT?lat=<>&long=<>               -> SafeGuardian WBGT (POST upstream)
//   GET /HeavyRain?ts=<unix>                  -> NEA heavy rain warnings
//   GET /RainArea?ts=<unix>                   -> NEA recent rain area data
//
// All client-facing routes are GET. The proxy translates to POST upstream
// for the SafeGuardian CAT/WBGT endpoints which require form-urlencoded
// latitude/longitude in the request body.

const http = require('http');
const https = require('https');
const url = require('url');

const PORT = 3000;

const BEARER_TOKEN = "f9657ed00c9f3ee20b0fd15bc5b8c7e00fcf9e29fc2ca65ee71ed1dd933307bb";

// ---------------------------------------------------------------
// Forward an upstream HTTPS request to the client, with CORS headers.
// upstreamOptions can include: host, path, headers, method, body
// Defaults to GET with no body.
// ---------------------------------------------------------------
function forward(req, res, upstreamOptions) {
  const method = upstreamOptions.method || 'GET';
  const body = upstreamOptions.body;

  console.log(`[${new Date().toISOString()}] ${req.url} -> ${method} https://${upstreamOptions.host}${upstreamOptions.path}`);

  // If sending a body, ensure the right headers are set
  const headers = { ...upstreamOptions.headers };
  if (body) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/x-www-form-urlencoded';
    headers['Content-Length'] = Buffer.byteLength(body);
  }

  const upstreamReq = https.request({
    host: upstreamOptions.host,
    path: upstreamOptions.path,
    method: method,
    headers: headers
  }, upstream => {
    let respBody = '';
    upstream.on('data', chunk => { respBody += chunk; });
    upstream.on('end', () => {
      console.log(`   <- ${upstream.statusCode} (${respBody.length} bytes)`);
      res.statusCode = upstream.statusCode || 502;
      res.setHeader('Content-Type', upstream.headers['content-type'] || 'application/json');
      res.end(respBody);
    });
  });

  upstreamReq.on('error', err => {
    console.error('Upstream error:', err.message);
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Upstream request failed', detail: err.message }));
  });

  if (body) {
    upstreamReq.write(body);
  }
  upstreamReq.end();
}

// ---------------------------------------------------------------
// Validate that ?ts= is a plausible unix timestamp.
// Returns the cleaned string, or null if invalid.
// ---------------------------------------------------------------
function parseTimestamp(query) {
  const ts = query.ts;
  if (!ts) return null;
  // Allow 10-digit (seconds) or 13-digit (milliseconds) integer strings
  if (!/^\d{10}(\d{3})?$/.test(ts)) return null;
  return ts;
}

// ---------------------------------------------------------------
// Validate ?lat= and ?long= are real numbers in plausible ranges.
// Returns { lat, long } as strings, or null if invalid.
// ---------------------------------------------------------------
function parseLatLong(query) {
  const lat = query.lat;
  const long = query.long;
  if (lat === undefined || long === undefined) return null;

  const latNum = Number(lat);
  const longNum = Number(long);
  if (!Number.isFinite(latNum) || !Number.isFinite(longNum)) return null;
  if (latNum < -90 || latNum > 90) return null;
  if (longNum < -180 || longNum > 180) return null;

  return { lat: String(latNum), long: String(longNum) };
}

const server = http.createServer((req, res) => {
  // Strip /cat1 prefix if present (added by Cloudflare path routing)
  if (req.url.startsWith('/cat1/')) {
    req.url = req.url.slice('/cat1'.length);
  } else if (req.url === '/cat1') {
    req.url = '/';
  }

  // CORS for any origin (including file:// which shows up as null)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const query = parsed.query;

  // -----------------------------
  // /getWeatherInfo  (SafeGuardian, GET)
  // -----------------------------
  if (pathname === '/getWeatherInfo') {
    return forward(req, res, {
      host: 'safeguardian.defence.gov.sg',
      path: '/api-m/v2/prelogin/getWeatherInfo',
      headers: {
        'Authorization': `Bearer ${BEARER_TOKEN}`,
        'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 12; SM-G998B Build/SP1A.210812.016)',
        'Accept': 'application/json'
      }
    });
  }

  // -----------------------------
  // /getCATInfo?lat=<>&long=<>  (SafeGuardian, POST upstream)
  // -----------------------------
  if (pathname === '/getCATInfo') {
    const coords = parseLatLong(query);
    if (!coords) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'Missing or invalid ?lat=<>&long=<>' }));
    }
    return forward(req, res, {
      host: 'safeguardian.defence.gov.sg',
      path: '/api-m/v2/prelogin/getCATInfo',
      method: 'POST',
      body: `latitude=${encodeURIComponent(coords.lat)}&longitude=${encodeURIComponent(coords.long)}`,
      headers: {
        'Authorization': `Bearer ${BEARER_TOKEN}`,
        'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 12; SM-G998B Build/SP1A.210812.016)',
        'Accept': 'application/json'
      }
    });
  }

  // -----------------------------
  // /getWBGT?lat=<>&long=<>  (SafeGuardian, POST upstream)
  // -----------------------------
  if (pathname === '/getWBGT') {
    const coords = parseLatLong(query);
    if (!coords) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'Missing or invalid ?lat=<>&long=<>' }));
    }
    return forward(req, res, {
      host: 'safeguardian.defence.gov.sg',
      path: '/api-m/v2/prelogin/getWBGT',
      method: 'POST',
      body: `latitude=${encodeURIComponent(coords.lat)}&longitude=${encodeURIComponent(coords.long)}`,
      headers: {
        'Authorization': `Bearer ${BEARER_TOKEN}`,
        'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 12; SM-G998B Build/SP1A.210812.016)',
        'Accept': 'application/json'
      }
    });
  }

  // -----------------------------
  // /HeavyRain?ts=<unix>  (NEA, GET)
  // -----------------------------
  if (pathname === '/HeavyRain') {
    const ts = parseTimestamp(query);
    if (!ts) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'Missing or invalid ?ts=<unix timestamp>' }));
    }
    return forward(req, res, {
      host: 'www.nea.gov.sg',
      path: `/api/Warning/GetHeavyRain/${ts}`,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      }
    });
  }

  // -----------------------------
  // /RainArea?ts=<unix>  (NEA, GET)
  // -----------------------------
  if (pathname === '/RainArea') {
    const ts = parseTimestamp(query);
    if (!ts) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'Missing or invalid ?ts=<unix timestamp>' }));
    }
    return forward(req, res, {
      host: 'www.nea.gov.sg',
      path: `/api/RainArea/GetRecentData/${ts}`,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      }
    });
  }

  // -----------------------------
  // Unknown path
  // -----------------------------
  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    error: 'Not found',
    routes: [
      'GET /getWeatherInfo',
      'GET /getCATInfo?lat=<>&long=<>',
      'GET /getWBGT?lat=<>&long=<>',
      'GET /HeavyRain?ts=<unix>',
      'GET /RainArea?ts=<unix>'
    ]
  }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Proxy running at http://localhost:${PORT}`);
  console.log(`  GET /getWeatherInfo            ->  safeguardian.defence.gov.sg/api-m/v2/prelogin/getWeatherInfo`);
  console.log(`  GET /getCATInfo?lat=<>&long=<> ->  safeguardian.defence.gov.sg/api-m/v2/prelogin/getCATInfo (POST)`);
  console.log(`  GET /getWBGT?lat=<>&long=<>    ->  safeguardian.defence.gov.sg/api-m/v2/prelogin/getWBGT (POST)`);
  console.log(`  GET /HeavyRain?ts=<unix>       ->  www.nea.gov.sg/api/Warning/GetHeavyRain/<unix>`);
  console.log(`  GET /RainArea?ts=<unix>        ->  www.nea.gov.sg/api/RainArea/GetRecentData/<unix>`);
});
