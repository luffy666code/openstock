# Changelog

## 1.0.0

- First public release as a platform-agnostic stdio MCP server.
- 6 read-only tools: stock search, quote, company profile, market news, company news, batch quotes.
- Zero npm dependencies (Node 18+ built-in fetch).
- Finnhub API key read from the OS environment only.
- Response caching, concurrency limiting, and clear HTTP 429/401/403 handling.
- Equity tickers and crypto pairs supported.
