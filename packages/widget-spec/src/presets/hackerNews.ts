import type { WidgetPreset } from '@lobechat/types';

// The script runs in the widget sandbox (node, global fetch, no packages).
const SCRIPT = String.raw`// The top Hacker News stories right now.
const limit = Math.min(Math.max(Number(process.env.LIMIT) || 8, 1), 20);
const base = 'https://hacker-news.firebaseio.com/v0/';
const get = async (path) => {
  const res = await fetch(base + path);
  if (!res.ok) throw new Error('Hacker News answered ' + res.status);
  return res.json();
};

const ids = (await get('topstories.json')).slice(0, limit);
const stories = await Promise.all(ids.map((id) => get('item/' + id + '.json')));

console.log(JSON.stringify({
  items: stories.filter(Boolean).map((s) => ({
    // job posts have no comments
    description: (s.descendants ?? 0) + ' comments · by ' + s.by,
    time: new Date(s.time * 1000).toISOString(),
    title: s.title,
    url: s.url || 'https://news.ycombinator.com/item?id=' + s.id,
    value: s.score,
  })),
  type: 'list',
}));
`;

export const hackerNews: WidgetPreset = {
  id: 'hacker-news-top',
  version: '1.0.0',
  category: 'content',
  contract: 'hacker-news-top.v1',
  tags: ['news', 'hacker news'],
  title: 'Hacker News top stories',
  description:
    'The stories on the Hacker News front page right now, with points and comment counts. Each opens in a new tab.',
  locales: {
    'zh-CN': {
      title: 'Hacker News 热门',
      description: 'Hacker News 首页当前的热门文章，附分数和评论数，点击即可打开原文。',
      params: {
        LIMIT: {
          label: '条数',
        },
      },
    },
  },
  size: {
    w: 6,
    h: 4,
  },
  sample: {
    items: [
      {
        description: '266 comments · by karpathy',
        time: '2026-10-31T19:56:53.000Z',
        title: 'HackerTube: YouTube built from videos recommended by HN',
        url: 'https://karpathy.bearblog.dev/hacker-tube/',
        value: 822,
      },
      {
        description: '58 comments · by ecares',
        time: '2026-10-31T22:41:06.000Z',
        title: 'An Italian farmer found some unknown seeds in his attic and planted them',
        url: 'https://www.smithsonianmag.com/science-nature/italian-farmer-found-unknown-seeds-attic-with-nothing-lose-planted-them-result-biblical-180989644/',
        value: 196,
      },
      {
        description: '178 comments · by oger',
        time: '2026-10-31T19:16:30.000Z',
        title: 'TCP Use-After-Free: CVE-2026-98432 / CVSS 9.8',
        url: 'https://atlasum.net/blog/cve-2026-98432-linux-ipv4-tcp-uaf',
        value: 373,
      },
      {
        description: '55 comments · by guregodevo',
        time: '2026-10-31T22:46:12.000Z',
        title: 'Memdoor: A team of 5 Qwen3.8-27B models beats Fable 5 on LiveCodeBench Hard',
        url: 'https://github.com/guregodevo/memdoor/tree/main/examples/workflows/team-solve',
        value: 108,
      },
      {
        description: '3 comments · by uvdn7',
        time: '2026-10-31T22:54:55.000Z',
        title: 'Altoids Project',
        url: 'https://uvdn7.github.io/altoids-project/',
        value: 59,
      },
    ],
    type: 'list',
  },
  widget: {
    runtime: 'node',
    outputType: 'list',
    script: SCRIPT,
    manifest: {
      network: {
        allow: ['hacker-news.firebaseio.com'],
      },
      schedule: {
        pattern: '*/30 * * * *',
      },
      params: [
        {
          name: 'LIMIT',
          type: 'number',
          label: 'Stories',
          default: 8,
        },
      ],
    },
    view: {
      limit: 20,
    },
  },
};
