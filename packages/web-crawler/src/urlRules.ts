import type { CrawlUrlRule } from './type';

export const crawUrlRules: CrawlUrlRule[] = [
  // Sogou WeChat links, use search1api
  {
    impls: ['search1api'],
    urlPattern: 'https://weixin.sogou.com/link(.*)',
  },
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
  // Reddit links, use search1api, formatted as markdown, includes title, author, interaction count, specific comment content, etc.
  {
    impls: ['search1api'],
    urlPattern: 'https://www.reddit.com/r/(.*)/comments/(.*)',
  },
  // WeChat official accounts have crawler protection, use search1api first, jina as fallback (currently jina crawling may be blocked)
  {
    impls: ['search1api', 'jina'],
    urlPattern: 'https://mp.weixin.qq.com(.*)',
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
  // Zhihu has crawler protection, use jina
  {
    impls: ['jina'],
    urlPattern: 'https://zhuanlan.zhihu.com(.*)',
  },
  {
    impls: ['jina'],
    urlPattern: 'https://zhihu.com(.*)',
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
