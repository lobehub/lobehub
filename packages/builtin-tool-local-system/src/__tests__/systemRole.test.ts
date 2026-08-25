import { describe, expect, it } from 'vitest';

import { systemPrompt as genericPrompt } from '../systemRole';
import { systemPrompt as desktopPrompt } from '../systemRole.desktop';

const extractPlaceholders = (template: string): Set<string> =>
  new Set([...template.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]));

describe('systemRole templates', () => {
  /**
   * The generic template is what the server renders for gateway runs; the
   * `.desktop` variant is a client-only vite module swap. Keep the environment
   * facts in sync: a placeholder present only in the desktop variant means
   * gateway prompts silently lose information the local prompt has (this is
   * how gateway runs ended up without the known-locations list).
   */
  it('generic template carries every placeholder the desktop variant has', () => {
    const generic = extractPlaceholders(genericPrompt);
    const desktopOnly = [...extractPlaceholders(desktopPrompt)].filter((key) => !generic.has(key));

    expect(desktopOnly).toEqual([]);
  });

  it('both templates pair {{defaultShell}} with {{shellSyntaxGuidance}}', () => {
    for (const template of [genericPrompt, desktopPrompt]) {
      expect(template).toContain('{{defaultShell}}');
      expect(template).toContain('{{shellSyntaxGuidance}}');
    }
  });
});
