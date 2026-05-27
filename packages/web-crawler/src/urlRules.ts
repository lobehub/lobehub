import type { CrawlUrlRule } from './type';

export const crawUrlRules: CrawlUrlRule[] = [
  // Sogou links, use search1api
  {
    impls: ['search1api'],
    urlPattern: 'https://sogou.com/link(.*)',
  },
  // YouTube links, use search1api, formatted as markdown, can return subtitle content
  {
    impls: ['search1api'],
    urlPattern: 'https://www.youtube.com/watch(.*)',
  },
  // Reddit listing pages (top/hot/new/rising/controversial) — rewrite to JSON API to bypass bot detection
  // e.g. /r/Entrepreneur/top/?t=year → /r/Entrepreneur/top.json?t=year
  {
    filterOptions: { enableReadability: false },
    impls: ['naive'],
    urlPattern:
      'https://www.reddit.com/r/([^/?#]+)/(top|hot|new|rising|controversial)(?:/)?([?][^#]*)?$',
    urlTransform: 'https://www.reddit.com/r/$1/$2.json$3',
  },
  // Bare subreddit URL — rewrite to hot.json
  // e.g. /r/Entrepreneur/ → /r/Entrepreneur/hot.json
  {
    filterOptions: { enableReadability: false },
    impls: ['naive'],
    urlPattern: 'https://www.reddit.com/r/([^/?#]+)/?([?][^#]*)?$',
    urlTransform: 'https://www.reddit.com/r/$1/hot.json$2',
  },
  // Reddit individual post/comments — use search1api for rich markdown with comment thread
  {
    impls: ['search1api', 'jina'],
    urlPattern: 'https://www.reddit.com/r/(.*)/comments/(.*)',
  },
  // GitHub source code parsing
  {
    filterOptions: {
      enableReadability: false,
    },
    impls: ['naive', 'jina'],
    urlPattern: 'https://github.com/([^/]+)/([^/]+)/blob/([^/]+)/(.*)',
    urlTransform: 'https://github.com/$1/$2/raw/refs/heads/$3/$4',
  },
  {
    filterOptions: {
      enableReadability: false,
    },
    impls: ['naive', 'jina'],
    // GitHub discussion
    urlPattern: 'https://github.com/(.*)/discussions/(.*)',
  },
  // All PDFs use jina
  {
    impls: ['jina'],
    urlPattern: 'https://(.*).pdf',
  },
  // arxiv PDF use jina
  {
    impls: ['jina'],
    urlPattern: 'https://arxiv.org/pdf/(.*)',
  },
  {
    // Convert Medium articles to Scribe.rip
    urlPattern: 'https://medium.com/(.*)',
    urlTransform: 'https://scribe.rip/$1',
  },
  {
    filterOptions: {
      enableReadability: false,
    },
    impls: ['jina', 'browserless'],
    urlPattern: 'https://(twitter.com|x.com)/(.*)',
  },
  // Sports data website rules
  {
    filterOptions: {
      // Disable Readability for sports data tables and convert to plain text
      enableReadability: false,
      pureText: true,
    },
    impls: ['naive'],
    urlPattern: 'https://www.qiumiwu.com/standings/(.*)',
  },
  // mozilla use jina
  {
    impls: ['jina'],
    urlPattern: 'https://developer.mozilla.org(.*)',
  },
  // cvpr thecvf
  {
    impls: ['jina'],
    urlPattern: 'https://cvpr.thecvf.com(.*)',
  },
  // Feishu use jina
  // https://github.com/lobehub/lobe-chat/issues/6879
  {
    impls: ['jina'],
    urlPattern: 'https://(.*).feishu.cn/(.*)',
  },
  // Xiaohongshu has crawler protection, use Search1API or Jina (fallback)
  {
    impls: ['search1api', 'jina'],
    urlPattern: 'https://(.*).xiaohongshu.com/(.*)',
  },
];
