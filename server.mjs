#!/usr/bin/env node
// OpenStock-inspired stock-data MCP adapter. Not the original OpenStock website.
// Stdout is exclusively newline-delimited JSON-RPC 2.0 (MCP stdio).
import readline from 'node:readline';
import { makeFinnhubClient } from './finnhub.mjs';
import { TOOLS, callTool } from './tools.mjs';

const client = makeFinnhubClient();
const KNOWN_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);
const write = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const ok = (id, result) => write({ jsonrpc: '2.0', id, result });
const err = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(req) {
  if (!req || typeof req !== 'object' || Array.isArray(req) || req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    err(req?.id ?? null, -32600, 'Invalid Request'); return;
  }
  // Notifications are never answered: they do not carry an id.
  if (!Object.prototype.hasOwnProperty.call(req, 'id')) return;
  const id = req.id;
  switch (req.method) {
    case 'initialize': {
      const requested = req.params?.protocolVersion;
      ok(id, {
        protocolVersion: KNOWN_VERSIONS.has(requested) ? requested : '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'openstock-finnhub-mcp', version: '1.0.0' },
        instructions: 'Unofficial OpenStock-inspired adapter. Read-only Finnhub market-data tools. A Finnhub API key is required for calls; quotes may be delayed.'
      });
      break;
    }
    case 'ping': ok(id, {}); break;
    case 'tools/list': ok(id, { tools: TOOLS }); break;
    case 'tools/call': {
      const name = req.params?.name;
      if (typeof name !== 'string') { err(id, -32602, 'Missing tool name'); break; }
      if (!TOOLS.some(t => t.name === name)) { err(id, -32602, `Unknown tool: ${name}`); break; }
      try {
        const value = await callTool(client, name, req.params?.arguments ?? {});
        ok(id, { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false });
      } catch (error) {
        ok(id, { content: [{ type: 'text', text: String(error?.message || error) }], isError: true });
      }
      break;
    }
    default: err(id, -32601, `Method not found: ${req.method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async line => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); }
  catch { err(null, -32700, 'Parse error'); return; }
  if (Array.isArray(req)) { err(null, -32600, 'Batch JSON-RPC is unsupported'); return; }
  try { await handle(req); }
  catch (error) { err(req?.id ?? null, -32603, 'Internal server error'); console.error(String(error)); }
});
