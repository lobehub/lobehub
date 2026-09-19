import { describe, expect, it } from 'vitest';

import {
  evidenceTitleFromMarkdown,
  rendersAsMarkdown,
  resolveMarkdownEvidenceFold,
} from './MarkdownEvidence';

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

describe('resolveMarkdownEvidenceFold — authored alt as the fold title', () => {
  const DOC = '## 环境说明\n\n正文第一段。';

  it('uses the authored alt/description as the fold title and folds the row', () => {
    const { fold, foldTitle } = resolveMarkdownEvidenceFold(DOC, 'T-338 审计补充说明');
    expect(fold).toBe(true);
    expect(foldTitle).toBe('T-338 审计补充说明');
  });

  it('keeps the document-first-line label when no title is given', () => {
    const { fold, foldTitle } = resolveMarkdownEvidenceFold(DOC);
    expect(fold).toBe(true);
    expect(foldTitle).toBe('环境说明');
  });

  it('folds a short single-line doc when an explicit title is present', () => {
    // Without a title this renders inline (too short to be worth folding);
    // an authored title means the row label IS the point, so it folds anyway.
    const { fold, foldTitle } = resolveMarkdownEvidenceFold('只有一行正文。', '一句简短说明');
    expect(fold).toBe(true);
    expect(foldTitle).toBe('一句简短说明');
  });

  it('renders a short single-line doc inline when no title is given', () => {
    expect(resolveMarkdownEvidenceFold('只有一行正文。').fold).toBe(false);
  });

  it('ignores a blank authored title (falls back to the derived one)', () => {
    const { fold, foldTitle } = resolveMarkdownEvidenceFold(DOC, '   ');
    expect(fold).toBe(true);
    expect(foldTitle).toBe('环境说明');
  });
});

describe('evidence labels preserve artifact identity', () => {
  it('uses the description instead of a JSON opening brace', () => {
    expect(evidenceTitleFromMarkdown('{\n  "status": "done"\n}', 'Goal final state')).toBe(
      'Goal final state',
    );
  });

  it('keeps a file name when there is no meaningful description', () => {
    expect(evidenceTitleFromMarkdown('{\n}', '  ', 'goal-final-state.json')).toBe(
      'goal-final-state.json',
    );
  });

  it('preserves markdown links as prose titles', () => {
    expect(evidenceTitleFromMarkdown('[Report](https://example.com)')).toBe('Report');
  });

  it('labels legacy JSON objects and arrays without exposing raw payloads as titles', () => {
    expect(evidenceTitleFromMarkdown('{\n  "status": "done"\n}')).toBe('JSON');
    expect(evidenceTitleFromMarkdown('[{"id":"wk_123"}]')).toBe('JSON');
  });
});

it('folds short JSON payloads behind a readable type label', () => {
  expect(resolveMarkdownEvidenceFold('[{"id":"wk_123"}]')).toEqual({
    fold: true,
    foldTitle: 'JSON',
  });
});

describe('rendersAsMarkdown — only a markdown document is rendered as prose', () => {
  it('renders a captured transcript verbatim so its ### and - stay literal', () => {
    expect(rendersAsMarkdown({ fileName: '04-confirmation.txt', type: 'text' })).toBe(false);
    expect(rendersAsMarkdown({ fileName: 'server.log', type: 'text' })).toBe(false);
    // No extension at all is the same case: nothing says it is markdown.
    expect(rendersAsMarkdown({ fileName: 'transcript', type: 'text' })).toBe(false);
    expect(rendersAsMarkdown({ type: 'text' })).toBe(false);
  });

  it('renders a markdown document as prose, by type or by extension', () => {
    expect(rendersAsMarkdown({ fileName: 'findings.md', type: 'markdown' })).toBe(true);
    expect(rendersAsMarkdown({ type: 'markdown' })).toBe(true);
    // Uploaded as text but named .md — the name is the explicit signal.
    expect(rendersAsMarkdown({ fileName: 'report.MARKDOWN', type: 'text' })).toBe(true);
  });
});
