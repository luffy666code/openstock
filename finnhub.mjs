// Independent Finnhub data client for the MCP server.
// API endpoint choices are based on OpenStock's lib/actions/finnhub.actions.ts.
const API_BASE = 'https://finnhub.io/api/v1';
const SYMBOL = /^(?:BINANCE:[A-Z0-9]{2,20}|[A-Z0-9][A-Z0-9.\-]{0,19})$/;
const MAX_CACHE_ITEMS = 300;

export function cleanSymbol(raw) {
  if (typeof raw !== 'string') throw new Error('symbol must be a string');
  const value = raw.trim().toUpperCase();
  if (!SYMBOL.test(value)) throw new Error('Invalid stock symbol. Example: AAPL, 7203.T, BINANCE:BTCUSDT');
  return value;
}

export function cleanQuery(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > 80) {
    throw new Error('query must be non-empty text up to 80 characters');
  }
  return raw.trim();
}

export function toPositiveLimit(value, defaultLimit = 8, maxLimit = 20) {
  const n = value === undefined ? defaultLimit : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > maxLimit) throw new Error(`limit must be an integer between 1 and ${maxLimit}`);
  return n;
}

function utcDate(daysAgo = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function safeNewsList(data, limit) {
  if (!Array.isArray(data)) throw new Error('Unexpected Finnhub news response');
  const seen = new Set();
  const out = [];
  for (const a of data) {
    if (!a || typeof a.headline !== 'string' || typeof a.url !== 'string' || !/^https?:\/\//i.test(a.url)) continue;
    const key = a.id || a.url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      headline: a.headline,
      source: a.source ?? null,
      summary: typeof a.summary === 'string' ? a.summary.slice(0, 800) : null,
      url: a.url,
      datetime: Number.isFinite(a.datetime) ? a.datetime : null,
      image: typeof a.image === 'string' ? a.image : null,
      related: a.related ?? null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function makeFinnhubClient({ fetchImpl = globalThis.fetch, env = process.env, now = () => Date.now() } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('This Node.js runtime does not provide fetch(); use Node 18+');
  // All secrets come only from the OS process environment, never tool arguments.
  // Do not read NEXT_PUBLIC_* keys, which are intended for browser-exposed values.
  const keys = String(env.FINNHUB_API_KEYS || env.FINNHUB_API_KEY || '')
    .split(',').map(k => k.trim()).filter(Boolean);
  const cache = new Map();
  const pending = new Map();
  let keyIndex = 0;
  let inFlight = 0;
  const queue = [];

  async function withLimit(job) {
    if (inFlight >= 2) await new Promise(resolve => queue.push(resolve));
    inFlight++;
    try { return await job(); }
    finally { inFlight--; queue.shift()?.(); }
  }

  async function request(endpoint, params, ttlMs) {
    if (!keys.length) throw new Error('Missing FINNHUB_API_KEY; set it in the OS environment variables');
    const url = new URL(API_BASE + endpoint);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const cacheKey = url.toString(); // Secret is sent in headers, never embedded in URL.
    const hit = cache.get(cacheKey);
    if (hit && hit.expires > now()) return hit.value;
    if (pending.has(cacheKey)) return pending.get(cacheKey);

    const task = withLimit(async () => {
      let response;
      for (let attempt = 0; attempt < keys.length; attempt++) {
        const apiKey = keys[keyIndex++ % keys.length];
        response = await fetchImpl(url, {
          method: 'GET', headers: { 'X-Finnhub-Token': apiKey, Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
        if (response.status !== 429) break;
      }
      if (!response.ok) {
        if (response.status === 429) throw new Error('Finnhub rate limit exceeded (HTTP 429). Retry later');
        if (response.status === 401 || response.status === 403) throw new Error(`Finnhub refused access (HTTP ${response.status}); check key, plan and symbol coverage`);
        throw new Error(`Finnhub request failed (HTTP ${response.status})`);
      }
      const value = await response.json();
      if (ttlMs > 0) {
        if (cache.size >= MAX_CACHE_ITEMS) cache.delete(cache.keys().next().value);
        cache.set(cacheKey, { value, expires: now() + ttlMs });
      }
      return value;
    });
    pending.set(cacheKey, task);
    try { return await task; }
    finally { pending.delete(cacheKey); }
  }

  return {
    async search(query, limit = 10) {
      const q = cleanQuery(query);
      const data = await request('/search', { q }, 30 * 60_000);
      if (!Array.isArray(data?.result)) throw new Error('Unexpected Finnhub search response');
      return { query: q, results: data.result.slice(0, toPositiveLimit(limit, 10, 20)).map(x => ({
        symbol: x.symbol ?? null, name: x.description ?? null,
        displaySymbol: x.displaySymbol ?? null, type: x.type ?? null,
      })), source: 'Finnhub', retrievedAt: new Date(now()).toISOString() };
    },
    async quote(symbol) {
      const ticker = cleanSymbol(symbol);
      const q = await request('/quote', { symbol: ticker }, 30_000);
      if (typeof q !== 'object' || q === null || Array.isArray(q)) throw new Error('Unexpected Finnhub quote response');
      const fields = ['c', 'd', 'dp', 'h', 'l', 'o', 'pc', 't'];
      const prices = Object.fromEntries(fields.map(k => [k, typeof q[k] === 'number' ? q[k] : null]));
      // Finnhub may return all-zero quote for an unsupported symbol.
      return { symbol: ticker, current: prices.c, change: prices.d, changePercent: prices.dp,
        high: prices.h, low: prices.l, open: prices.o, previousClose: prices.pc,
        providerTimestamp: prices.t, available: prices.c !== null && prices.c !== 0,
        source: 'Finnhub', retrievedAt: new Date(now()).toISOString(),
        note: 'Prices may be delayed depending on provider subscription and market coverage.' };
    },
    async profile(symbol) {
      const ticker = cleanSymbol(symbol);
      if (ticker.includes(':')) throw new Error('Company profiles require an equity ticker, not a crypto pair');
      const p = await request('/stock/profile2', { symbol: ticker }, 24 * 60 * 60_000);
      if (typeof p !== 'object' || p === null || Array.isArray(p)) throw new Error('Unexpected Finnhub profile response');
      return { symbol: ticker, available: Object.keys(p).length > 0,
        name: p.name ?? null, ticker: p.ticker ?? null, exchange: p.exchange ?? null,
        currency: p.currency ?? null, industry: p.finnhubIndustry ?? null,
        marketCapitalizationMillions: p.marketCapitalization ?? null,
        country: p.country ?? null, ipo: p.ipo ?? null,
        website: p.weburl ?? null, logo: p.logo ?? null,
        source: 'Finnhub', retrievedAt: new Date(now()).toISOString() };
    },
    async marketNews(category = 'general', limit = 8) {
      if (!['general', 'forex', 'crypto', 'merger'].includes(category)) throw new Error('category must be general, forex, crypto or merger');
      const items = await request('/news', { category }, 5 * 60_000);
      return { category, articles: safeNewsList(items, toPositiveLimit(limit)), source: 'Finnhub', retrievedAt: new Date(now()).toISOString() };
    },
    async companyNews(symbol, days = 5, limit = 8) {
      const ticker = cleanSymbol(symbol);
      if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('days must be an integer between 1 and 30');
      const from = utcDate(days), to = utcDate(0);
      const items = await request('/company-news', { symbol: ticker, from, to }, 5 * 60_000);
      return { symbol: ticker, from, to, articles: safeNewsList(items, toPositiveLimit(limit)),
        source: 'Finnhub', retrievedAt: new Date(now()).toISOString() };
    },
    async multipleQuotes(symbols) {
      if (!Array.isArray(symbols) || symbols.length === 0 || symbols.length > 10) throw new Error('symbols must be an array of 1–10 tickers');
      const cleaned = [...new Set(symbols.map(cleanSymbol))];
      const quotes = await Promise.all(cleaned.map(async symbol => {
        try { return await this.quote(symbol); }
        catch (e) { return { symbol, error: e.message }; }
      }));
      return { quotes, source: 'Finnhub', retrievedAt: new Date(now()).toISOString() };
    }
  };
}
