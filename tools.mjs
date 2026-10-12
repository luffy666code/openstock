export const TOOLS = [
  {
    name: 'search_stocks',
    description: '通过关键词搜索股票代码、名称和市场。基于 Finnhub /search，结果依交易所覆盖范围和 API 权限变化。',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', description: '股票名称或代码，如 Apple、NVIDIA、AAPL' },
      limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 }
    }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'get_stock_quote',
    description: '查询单只股票或支持的币对报价：现价、涨跌幅、开高低收、提供商时间戳。数据是否实时取决于 Finnhub 订阅。',
    inputSchema: { type: 'object', properties: {symbol: { type: 'string', description: '示例：AAPL、TSLA、7203.T、BINANCE:BTCUSDT' }}, required: ['symbol'], additionalProperties: false },
  },
  {
    name: 'get_company_profile',
    description: '查询股票所属公司的企业名称、交易所、所属行业、币种、市值、官网等公司资料。',
    inputSchema: { type: 'object', properties: {symbol: { type: 'string' }}, required: ['symbol'], additionalProperties: false },
  },
  {
    name: 'get_market_news',
    description: '查询最新市场新闻，支持 general、forex、crypto、merger 分类。',
    inputSchema: { type: 'object', properties: {
      category: { type: 'string', enum: ['general', 'forex', 'crypto', 'merger'], default: 'general' },
      limit: { type: 'integer', minimum: 1, maximum: 20, default: 8 }
    }, additionalProperties: false },
  },
  {
    name: 'get_company_news',
    description: '查询指定股票最近 N 天的公司新闻，返回文章来源、标题、摘要、时间和 URL。',
    inputSchema: { type: 'object', properties: {
      symbol: { type: 'string' }, days: { type: 'integer', minimum: 1, maximum: 30, default: 5 },
      limit: { type: 'integer', minimum: 1, maximum: 20, default: 8 }
    }, required: ['symbol'], additionalProperties: false },
  },
  {
    name: 'get_multiple_quotes',
    description: '查询最多 10 个股票代码的最新报价；部分失败时保留其他股票结果。',
    inputSchema: { type: 'object', properties: {
      symbols: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10 }
    }, required: ['symbols'], additionalProperties: false },
  }
];

export async function callTool(client, name, args = {}) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments must be an object');
  switch (name) {
    case 'search_stocks': return client.search(args.query, args.limit);
    case 'get_stock_quote': return client.quote(args.symbol);
    case 'get_company_profile': return client.profile(args.symbol);
    case 'get_market_news': return client.marketNews(args.category, args.limit);
    case 'get_company_news': return client.companyNews(args.symbol, args.days, args.limit);
    case 'get_multiple_quotes': return client.multipleQuotes(args.symbols);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}
