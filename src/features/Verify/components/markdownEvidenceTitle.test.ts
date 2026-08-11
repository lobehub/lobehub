import { describe, expect, it } from 'vitest';

import { evidenceTitleFromMarkdown } from './MarkdownEvidence';

describe('evidenceTitleFromMarkdown — the collapsed row label', () => {
  it('strips heading syntax so the first line reads as a sentence', () => {
    expect(evidenceTitleFromMarkdown('## 声明\n\n验收页的音频证据应复用对话播放器。')).toBe('声明');
  });

  it('strips bold / code / link syntax from the first line', () => {
    expect(
      evidenceTitleFromMarkdown('**环境**: worktree `lobehub-wt-x`(基线 [canary](https://x))'),
    ).toBe('环境: worktree lobehub-wt-x(基线 canary)');
  });

  it('skips blank lines and fence markers — a doc opening with a code block is labeled by its first code line', () => {
    expect(evidenceTitleFromMarkdown('\n\n```bash\n$ lh acceptance view --json\n```')).toBe(
      '$ lh acceptance view --json',
    );
  });

  it('strips list markers and blockquote prefixes', () => {
    expect(evidenceTitleFromMarkdown('- 第一条观察\n- 第二条')).toBe('第一条观察');
    expect(evidenceTitleFromMarkdown('> 引用的结论')).toBe('引用的结论');
  });

  it('truncates a run-on first line instead of overflowing the row', () => {
    const long = '这一行非常长'.repeat(40);
    const title = evidenceTitleFromMarkdown(long);
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(161);
  });

  it('returns empty for whitespace-only content (caller renders inline)', () => {
    expect(evidenceTitleFromMarkdown('   \n\n')).toBe('');
  });
});
