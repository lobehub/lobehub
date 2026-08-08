import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { markdownElements } from '../Markdown/plugins';
import { useChatMarkdown } from './useChatMarkdown';

// The hook reads a general-settings slice for the fade-in transition; stub it so
// the hook renders without a full store. We only assert plugin wiring here.
vi.mock('@/store/user', () => ({
  useUserStore: (selector: any) => selector({ settings: {} }),
}));
let mockTransitionMode = 'none';

vi.mock('@/store/user/selectors', () => ({
  userGeneralSettingsSelectors: { config: () => ({ transitionMode: mockTransitionMode }) },
}));

const remarkPluginFor = (tag: string) =>
  markdownElements.find((el) => el.tag === tag)?.remarkPlugin;

describe('useChatMarkdown (assistant / grouped message pipeline)', () => {
  afterEach(() => {
    mockTransitionMode = 'none';
  });

  it('excludes user-scoped plugins so echoed <skill>/<tool> tags never become chips', () => {
    const { result } = renderHook(() => useChatMarkdown({ id: 'a1', isGenerating: false }));

    const remarkPlugins = result.current.markdownProps.remarkPlugins ?? [];

    const skillPlugin = remarkPluginFor('skill');
    const toolPlugin = remarkPluginFor('tool');
    expect(skillPlugin).toBeTruthy();
    expect(toolPlugin).toBeTruthy();

    // The Skill / Tool plugins are `scope: 'user'` — they must not run on the
    // assistant path (the #2 fix). Before the fix, this hook included them.
    expect(remarkPlugins).not.toContain(skillPlugin);
    expect(remarkPlugins).not.toContain(toolPlugin);
  });

  it('still includes assistant-scoped plugins', () => {
    const { result } = renderHook(() => useChatMarkdown({ id: 'a2', isGenerating: false }));
    const remarkPlugins = result.current.markdownProps.remarkPlugins ?? [];

    // Sanity: an assistant-scoped plugin (e.g. LocalFile) is still wired in, so
    // the filter narrowed the set rather than emptying it.
    const assistantScoped = markdownElements.find(
      (el) => el.scope === 'assistant' && el.remarkPlugin,
    );
    expect(assistantScoped).toBeTruthy();
    expect(remarkPlugins).toContain(assistantScoped!.remarkPlugin);
  });

  it('keeps markdown footnotes visible when structured citations are absent', () => {
    const { result } = renderHook(() => useChatMarkdown({ id: 'a3', isGenerating: false }));

    expect(result.current.markdownProps.showFootnotes).toBe(true);
  });

  it('keeps animated disabled when streaming is disabled even during generation', () => {
    mockTransitionMode = 'fadeIn';

    const { result } = renderHook(() =>
      useChatMarkdown({ enableStream: false, id: 'a4', isGenerating: true }),
    );

    expect(result.current.markdownProps.animated).toBe(false);
    expect(result.current.markdownProps.enableStream).toBe(false);
  });
});
