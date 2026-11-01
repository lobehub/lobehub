import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { extractSkillImportRoutes, SkillImportRouteInjector } from '../SkillImportRouteInjector';

const createContext = (messages: any[] = []): PipelineContext => ({
  initialState: {
    messages: [],
    model: 'test-model',
    provider: 'test-provider',
  },
  isAborted: false,
  messages,
  metadata: {
    maxTokens: 4000,
    model: 'test-model',
  },
});

describe('extractSkillImportRoutes', () => {
  describe('marketplace URLs → importFromMarket', () => {
    it('extracts the identifier from a skill.md URL', () => {
      expect(
        extractSkillImportRoutes('Read https://lobehub.com/skills/anthropics-skills-pptx/skill.md'),
      ).toEqual([
        {
          identifier: 'anthropics-skills-pptx',
          method: 'importFromMarket',
          url: 'https://lobehub.com/skills/anthropics-skills-pptx/skill.md',
        },
      ]);
    });

    it('extracts the identifier from a bare skill page URL', () => {
      expect(
        extractSkillImportRoutes('https://lobehub.com/skills/openclaw-openclaw-github'),
      ).toEqual([
        {
          identifier: 'openclaw-openclaw-github',
          method: 'importFromMarket',
          url: 'https://lobehub.com/skills/openclaw-openclaw-github',
        },
      ]);
    });

    it('handles locale-prefixed and subdomain/API URLs', () => {
      expect(
        extractSkillImportRoutes(
          'https://lobehub.com/zh-CN/skills/a-b and https://market.lobehub.com/api/v1/skills/c.d/download',
        ).map((route) => route.identifier),
      ).toEqual(['a-b', 'c.d']);
    });

    it('ignores a skills index URL with no identifier', () => {
      expect(extractSkillImportRoutes('https://lobehub.com/skills')).toEqual([]);
    });

    // No identifier to extract, but it is still a SKILL.md, which importSkill accepts.
    it('falls through to importSkill when the path has no identifier to extract', () => {
      expect(extractSkillImportRoutes('https://lobehub.com/skills/skill.md')).toEqual([
        { method: 'importSkill', type: 'url', url: 'https://lobehub.com/skills/skill.md' },
      ]);
    });
  });

  // importSkill accepts a SKILL.md on any host, a GitHub repo or subdirectory, and a ZIP —
  // the route must cover all of them, not only the marketplace.
  describe('non-marketplace sources → importSkill', () => {
    it('routes a SKILL.md on any host without needing install intent', () => {
      expect(extractSkillImportRoutes('have a look at https://example.com/foo/SKILL.md')).toEqual([
        { method: 'importSkill', type: 'url', url: 'https://example.com/foo/SKILL.md' },
      ]);
    });

    it('routes a raw githubusercontent SKILL.md', () => {
      const url = 'https://raw.githubusercontent.com/anthropics/skills/main/skills/pptx/SKILL.md';

      expect(extractSkillImportRoutes(url)).toEqual([{ method: 'importSkill', type: 'url', url }]);
    });

    it('routes a GitHub skills subdirectory without needing install intent', () => {
      const url = 'https://github.com/anthropics/skills/tree/main/skills/pptx';

      expect(extractSkillImportRoutes(`see ${url}`)).toEqual([
        { method: 'importSkill', type: 'url', url },
      ]);
    });

    it('routes an ordinary GitHub repo when the message asks to install it', () => {
      expect(extractSkillImportRoutes('install https://github.com/foo/bar-tools')).toEqual([
        { method: 'importSkill', type: 'url', url: 'https://github.com/foo/bar-tools' },
      ]);
    });

    it('routes a ZIP package when the message asks to import it', () => {
      expect(extractSkillImportRoutes('导入 https://example.com/pack.zip')).toEqual([
        { method: 'importSkill', type: 'zip', url: 'https://example.com/pack.zip' },
      ]);
    });

    it('recognises Chinese install intent', () => {
      expect(extractSkillImportRoutes('帮我安装 https://github.com/foo/bar')).toHaveLength(1);
    });
  });

  // A repo link in a message about reviewing code must not be read as "install this skill".
  describe('false-positive guards', () => {
    it('ignores a bare GitHub repo with no install intent', () => {
      expect(extractSkillImportRoutes('what do you think of https://github.com/foo/bar')).toEqual(
        [],
      );
    });

    it('ignores a bare ZIP with no install intent', () => {
      expect(extractSkillImportRoutes('unpack https://example.com/data.zip')).toEqual([]);
    });

    it('ignores unrelated URLs even when install intent is present', () => {
      expect(
        extractSkillImportRoutes('install deps then open https://lobehub.com/discover/assistants'),
      ).toEqual([]);
    });

    it('returns nothing for empty input', () => {
      expect(extractSkillImportRoutes('')).toEqual([]);
    });
  });

  describe('collection behaviour', () => {
    it('mixes marketplace and non-marketplace sources in one message', () => {
      expect(
        extractSkillImportRoutes(
          'https://lobehub.com/skills/a-b/skill.md and https://example.com/x/SKILL.md',
        ).map((route) => route.method),
      ).toEqual(['importFromMarket', 'importSkill']);
    });

    it('strips trailing sentence punctuation from a URL', () => {
      expect(extractSkillImportRoutes('装一下 https://lobehub.com/skills/a-b。')[0].url).toBe(
        'https://lobehub.com/skills/a-b',
      );
    });

    // Regression for the CodeQL polynomial-ReDoS finding: stripping the trailing punctuation
    // with `/[...]+$/` retried from every offset, so a long punctuation run followed by one
    // more character cost O(n^2). `!` and `.` both sit inside URL_PATTERN's class, so this
    // shape is reachable from message text. A quadratic implementation blows the timeout here.
    it('handles a URL with a long trailing punctuation run in linear time', () => {
      const text = `https://example.com/${'!'.repeat(200_000)}a`;

      const started = Date.now();
      expect(extractSkillImportRoutes(text)).toEqual([]);
      expect(Date.now() - started).toBeLessThan(1000);
    });

    it('deduplicates repeated URLs', () => {
      expect(
        extractSkillImportRoutes(
          'https://lobehub.com/skills/x-y then https://lobehub.com/skills/x-y',
        ),
      ).toHaveLength(1);
    });

    it('caps the number of extracted routes', () => {
      const text = Array.from(
        { length: 8 },
        (_, i) => `https://lobehub.com/skills/skill-${i}`,
      ).join(' ');

      expect(extractSkillImportRoutes(text)).toHaveLength(5);
    });
  });
});

describe('SkillImportRouteInjector', () => {
  // Regression: a `lobehub.com/skills/{id}/skill.md` URL used to reach the model with no
  // turn-local guidance, so it crawled the page and followed the marketplace CLI steps
  // printed there instead of calling `importFromMarket`.
  it('injects the resolved call and forbids crawling when a skill URL is present', async () => {
    const injector = new SkillImportRouteInjector({ enabled: true });

    const result = await injector.process(
      createContext([
        {
          content:
            'Read https://lobehub.com/skills/anthropics-skills-pptx/skill.md and install it as documented.',
          role: 'user',
        },
      ]),
    );

    const content = result.messages[0].content as string;

    expect(content).toContain('<skill_import_route>');
    expect(content).toContain('install="importFromMarket"');
    expect(content).toContain('identifier="anthropics-skills-pptx"');
    expect(content).toContain('Do NOT crawl');
    expect(result.metadata.skillImportRoute).toEqual({
      injected: true,
      urls: ['https://lobehub.com/skills/anthropics-skills-pptx/skill.md'],
    });
  });

  it('names importSkill and its type for a non-marketplace source', async () => {
    const injector = new SkillImportRouteInjector({ enabled: true });

    const result = await injector.process(
      createContext([
        {
          content: 'install https://github.com/anthropics/skills/tree/main/skills/pptx',
          role: 'user',
        },
      ]),
    );

    const content = result.messages[0].content as string;

    expect(content).toContain('install="importSkill"');
    expect(content).toContain('type="url"');
    expect(content).not.toContain('importFromMarket" identifier');
  });

  // The CLI is a genuine fallback for agents with no Skill Store tool, so it stays in the
  // ladder — it just must never be the first step, which is what happened in the report.
  it('orders the install ladder importFromMarket → importSkill → CLI', async () => {
    const injector = new SkillImportRouteInjector({ enabled: true });

    const result = await injector.process(
      createContext([
        {
          content:
            'https://lobehub.com/skills/anthropics-skills-pptx/skill.md — install as documented',
          role: 'user',
        },
      ]),
    );

    const content = result.messages[0].content as string;
    const ladder = content.slice(content.indexOf('Install priority'));

    expect(ladder).toContain('never skip up it');
    expect(ladder.indexOf('importFromMarket')).toBeLessThan(ladder.indexOf('importSkill'));
    expect(ladder.indexOf('importSkill')).toBeLessThan(ladder.indexOf('market-cli'));
    expect(ladder).toContain('last resort');
    // The exact phrase that talked the model into the CLI in the original report.
    expect(content).toContain('install it as documented');
  });

  it('appends to the last user message only', async () => {
    const injector = new SkillImportRouteInjector({ enabled: true });

    const result = await injector.process(
      createContext([
        { content: 'https://lobehub.com/skills/old-one', role: 'user' },
        { content: 'ok', role: 'assistant' },
        { content: 'now https://lobehub.com/skills/new-one', role: 'user' },
      ]),
    );

    expect(result.messages[0].content).toBe('https://lobehub.com/skills/old-one');
    expect(result.messages[2].content).toContain('identifier="new-one"');
    expect(result.messages[2].content).not.toContain('identifier="old-one"');
  });

  it('handles multimodal content by appending to the last text part', async () => {
    const injector = new SkillImportRouteInjector({ enabled: true });

    const result = await injector.process(
      createContext([
        {
          content: [
            { image_url: { url: 'https://example.com/a.png' }, type: 'image_url' },
            { text: 'install https://lobehub.com/skills/a-b/skill.md', type: 'text' },
          ],
          role: 'user',
        },
      ]),
    );

    const parts = result.messages[0].content as any[];
    expect(parts[1].text).toContain('identifier="a-b"');
  });

  it('skips injection when no skill source is present', async () => {
    const injector = new SkillImportRouteInjector({ enabled: true });

    const result = await injector.process(
      createContext([{ content: 'make me a deck about otters', role: 'user' }]),
    );

    expect(result.messages[0].content).toBe('make me a deck about otters');
    expect(result.metadata.skillImportRoute).toBeUndefined();
  });

  it('skips injection when disabled', async () => {
    const injector = new SkillImportRouteInjector({ enabled: false });

    const result = await injector.process(
      createContext([
        { content: 'https://lobehub.com/skills/anthropics-skills-pptx/skill.md', role: 'user' },
      ]),
    );

    expect(result.messages[0].content).toBe(
      'https://lobehub.com/skills/anthropics-skills-pptx/skill.md',
    );
    expect(result.metadata.skillImportRoute).toBeUndefined();
  });

  it('skips injection when there is no user message', async () => {
    const injector = new SkillImportRouteInjector({ enabled: true });

    const result = await injector.process(
      createContext([{ content: 'https://lobehub.com/skills/a-b', role: 'assistant' }]),
    );

    expect(result.metadata.skillImportRoute).toBeUndefined();
  });
});
