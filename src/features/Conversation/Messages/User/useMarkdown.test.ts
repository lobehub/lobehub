import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { markdownElements } from '../../Markdown/plugins';
import { useMarkdown } from './useMarkdown';

// The hook only wires plugins/components; stub the long-content preview so the
// test does not pull the full store tree.
vi.mock('./components/ContentPreview', () => ({
  default: () => null,
}));

const remarkPluginFor = (tag: string) =>
  markdownElements.find((el) => el.tag === tag)?.remarkPlugin;

describe('useMarkdown (user message pipeline)', () => {
  it('includes the localFile plugin so file chips survive plain-markdown user messages', () => {
    const { result } = renderHook(() => useMarkdown('u1'));

    const remarkPlugins = result.current.remarkPlugins ?? [];

    // The chat input serializes attachments to `<localFile … />`. When a user
    // message renders from plain `content` (history replay / sync / share)
    // instead of Lexical editorData, dropping this plugin silently swallows
    // the chip. Before the fix, LocalFile was `scope: 'assistant'`.
    const localFilePlugin = remarkPluginFor('localFile');
    expect(localFilePlugin).toBeTruthy();
    expect(remarkPlugins).toContain(localFilePlugin);
  });

  it('still excludes assistant-scoped plugins', () => {
    const { result } = renderHook(() => useMarkdown('u2'));

    const remarkPlugins = result.current.remarkPlugins ?? [];

    const assistantScoped = markdownElements.find(
      (el) => el.scope === 'assistant' && el.remarkPlugin,
    );
    expect(assistantScoped).toBeTruthy();
    expect(remarkPlugins).not.toContain(assistantScoped!.remarkPlugin);
  });
});
