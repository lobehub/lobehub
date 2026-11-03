import type { WidgetPreset } from '@lobechat/types';

// The script runs in the widget sandbox (node, global fetch, no packages).
const SCRIPT = String.raw`// Stars, forks and open issues of one GitHub repository.
const repo = process.env.REPO || 'lobehub/lobehub';
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  console.error('REPO must look like owner/name');
  process.exit(1);
}

const headers = { 'User-Agent': 'lobehub-widget' };
if (process.env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;

const res = await fetch('https://api.github.com/repos/' + repo, { headers });
if (!res.ok) {
  console.error('GitHub answered ' + res.status + ' for ' + repo);
  process.exit(1);
}
const r = await res.json();

console.log(JSON.stringify({
  data: {
    description: r.description || '',
    forks: r.forks_count,
    issues: r.open_issues_count,
    language: r.language || '',
    name: r.full_name,
    pushedAt: r.pushed_at,
    stars: r.stargazers_count,
  },
  type: 'data',
}));
`;

export const githubRepo: WidgetPreset = {
  id: 'github-repo',
  version: '1.0.0',
  category: 'dev',
  contract: 'github-repo.v1',
  tags: ['github', 'stars', 'open source'],
  title: 'GitHub repository',
  description:
    'Stars, forks and open issues of a GitHub repository, with its star count trended over time. Connecting GitHub avoids rate limits.',
  locales: {
    'zh-CN': {
      title: 'GitHub 仓库',
      description:
        'GitHub 仓库的 Star、Fork 和未关闭 Issue 数，并记录 Star 的长期趋势。连接 GitHub 账号可以避免限流。',
      params: {
        REPO: {
          label: '仓库',
          description: 'owner/name，例如 lobehub/lobehub',
        },
      },
    },
  },
  size: {
    w: 4,
    h: 4,
  },
  sample: {
    data: {
      description:
        '🤯 LobeHub is your Chief Agent Operator, organizing your agents into 7×24 operations by hiring, scheduling, and reporting on your entire AI team.',
      forks: 16023,
      issues: 1193,
      language: 'TypeScript',
      name: 'lobehub/lobehub',
      pushedAt: '2026-11-01T03:16:37Z',
      stars: 83650,
    },
    type: 'data',
  },
  widget: {
    runtime: 'node',
    outputType: 'data',
    script: SCRIPT,
    manifest: {
      network: {
        allow: ['api.github.com'],
      },
      schedule: {
        pattern: '0 * * * *',
      },
      metric: {
        key: 'stars',
        unit: 'stars',
        valuePath: 'data.stars',
      },
      env: [
        {
          name: 'GITHUB_TOKEN',
          connector: 'github',
          required: false,
          description: 'Optional; raises the GitHub API rate limit',
        },
      ],
      params: [
        {
          name: 'REPO',
          type: 'string',
          label: 'Repository',
          description: 'owner/name, e.g. lobehub/lobehub',
          required: true,
          default: 'lobehub/lobehub',
        },
      ],
    },
    view: {
      surface: 'slate',
      layout: {
        type: 'stack',
        gap: 6,
        children: [
          {
            type: 'stack',
            direction: 'row',
            justify: 'between',
            align: 'center',
            gap: 8,
            children: [
              {
                type: 'text',
                value: {
                  bind: 'data.name',
                },
                weight: 'semibold',
              },
              {
                type: 'badge',
                value: {
                  bind: 'data.language',
                },
                visible: {
                  bind: 'data.language',
                  exists: true,
                },
              },
            ],
          },
          {
            type: 'stack',
            direction: 'row',
            align: 'center',
            gap: 8,
            children: [
              {
                type: 'icon',
                name: 'star',
                size: 28,
                color: 'gold',
              },
              {
                type: 'text',
                value: {
                  template: '{data.stars|compact}',
                },
                size: 'display',
              },
            ],
          },
          {
            type: 'stack',
            direction: 'row',
            gap: 14,
            children: [
              {
                type: 'stack',
                direction: 'row',
                gap: 4,
                align: 'center',
                children: [
                  {
                    type: 'icon',
                    name: 'git-fork',
                    size: 14,
                  },
                  {
                    type: 'text',
                    value: {
                      template: '{data.forks|compact}',
                    },
                    size: 'sm',
                  },
                ],
              },
              {
                type: 'stack',
                direction: 'row',
                gap: 4,
                align: 'center',
                children: [
                  {
                    type: 'icon',
                    name: 'circle-dot',
                    size: 14,
                  },
                  {
                    type: 'text',
                    value: {
                      template: '{data.issues|compact}',
                    },
                    size: 'sm',
                  },
                ],
              },
            ],
          },
          {
            type: 'spacer',
          },
          {
            type: 'text',
            value: {
              bind: 'data.description',
            },
            size: 'sm',
            tone: 'secondary',
            lines: 2,
            hideWhen: 'short',
          },
          {
            type: 'text',
            value: {
              bind: 'data.pushedAt',
              format: 'relative',
            },
            size: 'xs',
            tone: 'tertiary',
          },
        ],
      },
    },
  },
};
