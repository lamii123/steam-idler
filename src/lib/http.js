const https = require('https');
const config = require('../config');
const pkg = require('../../package.json');

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const USER_AGENT = `steam-idler/${pkg.version}`;

const agent = new https.Agent({
  keepAlive: true,
  maxSockets: 12,
  timeout: 15_000,
});

function isSteamHost(hostname) {
  return (
    hostname === 'steampowered.com' ||
    hostname.endsWith('.steampowered.com') ||
    hostname === 'steamcommunity.com' ||
    hostname.endsWith('.steamcommunity.com')
  );
}

/**
 * Normalizes and validates URLs that come back from Steam before they are
 * stored or rendered. Only HTTPS and Steam-owned hosts are accepted.
 */
function isSteamAssetUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' &&
      (isSteamHost(host) ||
        host.endsWith('.steamstatic.com') ||
        host.endsWith('.akamaihd.net'))
    );
  } catch {
    return false;
  }
}

function request(rawUrl, options = {}) {
  const {
    headers = {},
    timeoutMs = config.steamApiTimeoutMs,
    maxBytes = MAX_RESPONSE_BYTES,
    maxRedirects = MAX_REDIRECTS,
    allowNonSteamHost = false,
  } = options;

  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      reject(new Error('Invalid upstream URL'));
      return;
    }

    if (url.protocol !== 'https:') {
      reject(new Error('Only HTTPS upstream requests are allowed'));
      return;
    }

    if (!allowNonSteamHost && !isSteamHost(url.hostname.toLowerCase())) {
      reject(new Error(`Blocked upstream host: ${url.hostname}`));
      return;
    }

    const req = https.get(
      url,
      {
        agent,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Encoding': 'identity',
          ...headers,
        },
      },
      (res) => {
        const statusCode = res.statusCode || 0;

        if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
          res.resume();

          if (maxRedirects <= 0) {
            reject(new Error('Too many upstream redirects'));
            return;
          }

          let nextUrl;
          try {
            nextUrl = new URL(res.headers.location, url).toString();
          } catch {
            reject(new Error('Upstream returned an invalid redirect URL'));
            return;
          }

          request(nextUrl, {
            headers,
            timeoutMs,
            maxBytes,
            maxRedirects: maxRedirects - 1,
            allowNonSteamHost,
          }).then(resolve, reject);
          return;
        }

        const chunks = [];
        let total = 0;

        res.on('data', (chunk) => {
          total += chunk.length;
          if (total > maxBytes) {
            res.destroy(new Error('Upstream response exceeded the size limit'));
            return;
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          resolve({
            statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });

        res.on('error', reject);
      }
    );

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Upstream request timed out'));
    });
  });
}

async function getJson(rawUrl, options = {}) {
  const response = await request(rawUrl, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const preview = response.body.toString('utf8', 0, 200).replace(/\s+/g, ' ').trim();
    throw new Error(`Steam API HTTP ${response.statusCode}: ${preview || '(empty body)'}`);
  }

  try {
    return JSON.parse(response.body.toString('utf8'));
  } catch {
    throw new Error(`Steam API returned invalid JSON (HTTP ${response.statusCode})`);
  }
}

async function getHtml(rawUrl, options = {}) {
  // Steam's community pages are less picky when they see a browser-like UA.
  const response = await request(rawUrl, {
    ...options,
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      ...(options.headers || {}),
    },
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Steam community HTTP ${response.statusCode}`);
  }

  return response.body.toString('utf8');
}

module.exports = { getJson, getHtml, isSteamAssetUrl };
