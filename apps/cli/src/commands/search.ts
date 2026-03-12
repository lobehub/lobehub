import type { Command } from 'commander';
import pc from 'picocolors';

import { getToolsTrpcClient, getTrpcClient } from '../api/client';
import { outputJson, printTable, truncate } from '../utils/format';

const SEARCH_TYPES = [
  'agent',
  'topic',
  'file',
  'folder',
  'message',
  'page',
  'memory',
  'mcp',
  'plugin',
  'communityAgent',
  'knowledgeBase',
] as const;

type SearchType = (typeof SEARCH_TYPES)[number];

function renderResultGroup(type: string, items: any[]) {
  if (items.length === 0) return;

  console.log();
  console.log(pc.bold(pc.cyan(`── ${type} (${items.length}) ──`)));

  const rows = items.map((item: any) => [
    item.id || '',
    truncate(item.title || item.name || item.content || 'Untitled', 80),
    item.description ? truncate(item.description, 40) : '',
  ]);

  printTable(rows, ['ID', 'TITLE', 'DESCRIPTION']);
}

export function registerSearchCommand(program: Command) {
  const search = program
    .command('search')
    .description('Search across local resources or the web')
    .option('-q, --query <query>', 'Search query')
    .option('-w, --web', 'Search the web instead of local resources')
    .option('-t, --type <type>', `Filter by type: ${SEARCH_TYPES.join(', ')}`)
    .option('-L, --limit <n>', 'Results per type', '10')
    .option('-e, --engines <engines>', 'Web search engines (comma-separated, requires --web)')
    .option(
      '-c, --categories <categories>',
      'Web search categories (comma-separated, requires --web)',
    )
    .option(
      '-T, --time-range <range>',
      'Time range filter (e.g. day, week, month, year, requires --web)',
    )
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      async (options: {
        categories?: string;
        engines?: string;
        json?: string | boolean;
        limit?: string;
        query?: string;
        timeRange?: string;
        type?: string;
        web?: boolean;
      }) => {
        if (!options.query) {
          search.help();
          return;
        }

        if (options.web) {
          await webSearch(options.query, options);
        } else {
          await localSearch(options.query, options);
        }
      },
    );

  // ── search view ──────────────────────────────────────
  search
    .command('view <target>')
    .description('View details of a search result (URL for web results, or type:id for local)')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .option(
      '-i, --impl <impls>',
      'Crawler implementations for web URLs (comma-separated: browserless, exa, firecrawl, jina, naive, search1api, tavily)',
    )
    .action(
      async (
        target: string,
        options: {
          impl?: string;
          json?: string | boolean;
        },
      ) => {
        if (target.startsWith('http://') || target.startsWith('https://')) {
          await crawlView(target, options);
          return;
        }

        await localView(target, options);
      },
    );
}

// ── local search ──────────────────────────────────────

async function localSearch(
  query: string,
  options: { json?: string | boolean; limit?: string; type?: string },
) {
  if (options.type && !SEARCH_TYPES.includes(options.type as SearchType)) {
    console.error(`Invalid type: ${options.type}. Must be one of: ${SEARCH_TYPES.join(', ')}`);
    process.exit(1);
  }

  const client = await getTrpcClient();

  const input: { limitPerType?: number; query: string; type?: SearchType } = { query };
  if (options.type) input.type = options.type as SearchType;
  if (options.limit) input.limitPerType = Number.parseInt(options.limit, 10);

  const result = await client.search.query.query(input);

  if (options.json !== undefined) {
    const fields = typeof options.json === 'string' ? options.json : undefined;
    outputJson(result, fields);
    return;
  }

  if (Array.isArray(result)) {
    if (result.length === 0) {
      console.log('No results found.');
      return;
    }
    const groups: Record<string, any[]> = {};
    for (const item of result) {
      const t = item.type || 'other';
      if (!groups[t]) groups[t] = [];
      groups[t].push(item);
    }
    for (const [type, items] of Object.entries(groups)) {
      renderResultGroup(type, items);
    }
  } else if (result && typeof result === 'object') {
    const groups = result as Record<string, any[]>;
    let hasResults = false;
    for (const [type, items] of Object.entries(groups)) {
      if (Array.isArray(items) && items.length > 0) {
        hasResults = true;
        renderResultGroup(type, items);
      }
    }
    if (!hasResults) {
      console.log('No results found.');
    }
  }
}

// ── web search ────────────────────────────────────────

async function webSearch(
  query: string,
  options: {
    categories?: string;
    engines?: string;
    json?: string | boolean;
    timeRange?: string;
  },
) {
  const toolsClient = await getToolsTrpcClient();

  const input: {
    query: string;
    searchCategories?: string[];
    searchEngines?: string[];
    searchTimeRange?: string;
  } = { query };

  if (options.engines) input.searchEngines = options.engines.split(',').map((s) => s.trim());
  if (options.categories)
    input.searchCategories = options.categories.split(',').map((s) => s.trim());
  if (options.timeRange) input.searchTimeRange = options.timeRange;

  const result = await toolsClient.search.webSearch.query(input);

  if (options.json !== undefined) {
    const fields = typeof options.json === 'string' ? options.json : undefined;
    outputJson(result, fields);
    return;
  }

  const res = result as any;

  console.log(
    pc.dim(
      `Found ${res.resultNumbers ?? res.results?.length ?? 0} results in ${res.costTime ?? '?'}ms`,
    ),
  );

  if (!res.results || res.results.length === 0) {
    console.log('No results found.');
    return;
  }

  const rows = res.results.map((item: any) => [
    truncate(item.title || '', 50),
    truncate(item.url || '', 60),
    item.score != null ? String(item.score) : '',
    truncate(item.content || '', 60),
  ]);

  printTable(rows, ['TITLE', 'URL', 'SCORE', 'CONTENT']);
}

// ── crawl view (for web URLs) ─────────────────────────

async function crawlView(url: string, options: { impl?: string; json?: string | boolean }) {
  const toolsClient = await getToolsTrpcClient();

  const input: {
    impls?: ('browserless' | 'exa' | 'firecrawl' | 'jina' | 'naive' | 'search1api' | 'tavily')[];
    urls: string[];
  } = { urls: [url] };

  if (options.impl) {
    input.impls = options.impl.split(',').map((s) => s.trim()) as typeof input.impls;
  }

  const result = await toolsClient.search.crawlPages.mutate(input);

  if (options.json !== undefined) {
    const fields = typeof options.json === 'string' ? options.json : undefined;
    outputJson(result, fields);
    return;
  }

  const pages = Array.isArray(result) ? result : [result];

  for (const page of pages) {
    const p = page as any;
    console.log();
    console.log(pc.bold(pc.cyan(p.title || p.url || 'Untitled')));
    if (p.url) console.log(pc.dim(p.url));
    if (p.content) {
      console.log();
      console.log(p.content);
    }
  }
}

// ── local view (by type:id) ───────────────────────────

async function localView(target: string, options: { json?: string | boolean }) {
  const sep = target.indexOf(':');
  if (sep === -1) {
    console.error(
      'Invalid target. Use type:id (e.g. agent:abc123) for local resources, or a URL for web results.',
    );
    process.exit(1);
  }

  const type = target.slice(0, sep);
  const id = target.slice(sep + 1);

  if (!id) {
    console.error('Missing id. Format: type:id');
    process.exit(1);
  }

  const client = await getTrpcClient();

  let result: any;

  switch (type) {
    case 'agent': {
      result = await client.agent.getAgentConfigById.query({ agentId: id });
      break;
    }
    case 'file': {
      result = await client.file.getFileItemById.query({ id });
      break;
    }
    case 'knowledgeBase': {
      result = await client.knowledgeBase.getKnowledgeBaseById.query({ id });
      break;
    }
    default: {
      console.error(`View not supported for type "${type}". Supported: agent, file, knowledgeBase`);
      process.exit(1);
    }
  }

  if (!result) {
    console.error(`${type} not found: ${id}`);
    process.exit(1);
  }

  if (options.json !== undefined) {
    const fields = typeof options.json === 'string' ? options.json : undefined;
    outputJson(result, fields);
    return;
  }

  const r = result as any;
  console.log();
  console.log(pc.bold(r.title || r.name || r.identifier || id));
  if (r.description) console.log(pc.dim(r.description));
  if (r.type) console.log(`Type: ${r.type}`);
  if (r.createdAt) console.log(`Created: ${pc.dim(String(r.createdAt))}`);
  if (r.updatedAt) console.log(`Updated: ${pc.dim(String(r.updatedAt))}`);
  if (r.systemRole) {
    console.log();
    console.log(pc.cyan('System Role:'));
    console.log(r.systemRole);
  }
}
