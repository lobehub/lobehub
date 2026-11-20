import { describe, expect, it } from 'vitest';

import { resolveMarkdownSnapshotContent } from './commentRenderSource';

const text = (value: string, extra: Record<string, unknown> = {}) => ({
  detail: 0,
  format: 0,
  mode: 'normal',
  style: '',
  text: value,
  type: 'text',
  version: 1,
  ...extra,
});

const mention = (label: string, id: string) => ({
  label,
  metadata: { id, type: 'member' },
  type: 'mention',
  version: 1,
});

const paragraph = (...children: unknown[]) => ({ children, type: 'paragraph', version: 1 });

const snapshot = (...children: unknown[]) => ({ root: { children, type: 'root', version: 1 } });

describe('resolveMarkdownSnapshotContent', () => {
  // Shape of an agent comment that hand-built editorData only to carry mentions.
  const content = [
    '@Arvin @Lin 补测完成。',
    '',
    '**部署**',
    '- #21544（`b8485fce`）已上线。',
    '- 话题：tpc_x。',
  ].join('\n');
  const handBuilt = snapshot(
    paragraph(mention('Arvin', 'user_a'), text(' '), mention('Lin', 'user_b'), text(' 补测完成。')),
    paragraph(),
    paragraph(text('部署')),
    paragraph(text('- #21544（`b8485fce`）已上线。')),
    paragraph(text('- 话题：tpc_x。')),
  );

  it('renders the markdown body of a hand-built plain snapshot and restores its mentions', () => {
    expect(resolveMarkdownSnapshotContent({ content, editorData: handBuilt })).toBe(
      [
        '<mention name="Arvin" id="user_a" /> <mention name="Lin" id="user_b" /> 补测完成。',
        '',
        '**部署**',
        '- #21544（`b8485fce`）已上线。',
        '- 话题：tpc_x。',
      ].join('\n'),
    );
  });

  it('restores every mention of the same member in order', () => {
    expect(
      resolveMarkdownSnapshotContent({
        content: '@Lin 看下 `a`，@Lin 再确认',
        editorData: snapshot(
          paragraph(
            mention('Lin', 'user_b'),
            text(' 看下 `a`，'),
            mention('Lin', 'user_b'),
            text(' 再确认'),
          ),
        ),
      }),
    ).toBe(
      '<mention name="Lin" id="user_b" /> 看下 `a`，<mention name="Lin" id="user_b" /> 再确认',
    );
  });

  it('renders a body whose only formatting the snapshot dropped', () => {
    expect(
      resolveMarkdownSnapshotContent({
        content: '@Lin **部署** 完成，_详见_ 链接',
        editorData: snapshot(paragraph(mention('Lin', 'user_b'), text(' 部署 完成，详见 链接'))),
      }),
    ).toBe('<mention name="Lin" id="user_b" /> **部署** 完成，_详见_ 链接');
  });

  it('restores a mention at its own position, not at an earlier literal @Name', () => {
    expect(
      resolveMarkdownSnapshotContent({
        content: '`@Lin` is syntax; @Lin review **this**',
        editorData: snapshot(
          paragraph(text('`@Lin` is syntax; '), mention('Lin', 'user_b'), text(' review this')),
        ),
      }),
    ).toBe('`@Lin` is syntax; <mention name="Lin" id="user_b" /> review **this**');
  });

  it('keeps an editor snapshot whose body only escapes literal markers', () => {
    expect(
      resolveMarkdownSnapshotContent({
        content: 'snake\\_case and 2 \\* 3 \\* 4\n\nfine',
        editorData: snapshot(paragraph(text('snake_case and 2 * 3 * 4')), paragraph(text('fine'))),
      }),
    ).toBeUndefined();
  });

  it('keeps a body that already serializes its mention tags', () => {
    const tagged = content.replace('@Arvin', '<mention name="Arvin" id="user_a" />');

    expect(resolveMarkdownSnapshotContent({ content: tagged, editorData: handBuilt })).toBe(tagged);
  });

  it('keeps an editor snapshot without markdown source', () => {
    expect(
      resolveMarkdownSnapshotContent({
        content: '<mention name="Lin" id="user_b" /> looks good\n\nship it',
        editorData: snapshot(
          paragraph(mention('Lin', 'user_b'), text(' looks good')),
          paragraph(text('ship it')),
        ),
      }),
    ).toBeUndefined();
  });

  it('keeps plain text that only looks like a quote marker', () => {
    expect(
      resolveMarkdownSnapshotContent({
        content: '>_< 又挂了\n\n>= 3 次',
        editorData: snapshot(paragraph(text('>_< 又挂了')), paragraph(text('>= 3 次'))),
      }),
    ).toBeUndefined();
  });

  it('keeps snapshots with rich structure', () => {
    const list = { children: [{ children: [text('a')], type: 'listitem' }], type: 'list' };

    expect(
      resolveMarkdownSnapshotContent({ content: '- a', editorData: snapshot(list) }),
    ).toBeUndefined();
    expect(
      resolveMarkdownSnapshotContent({
        content: '**`x`**',
        editorData: snapshot(paragraph(text('`x`', { format: 1 }))),
      }),
    ).toBeUndefined();
  });

  it('keeps the snapshot when there is no markdown body or snapshot', () => {
    expect(resolveMarkdownSnapshotContent({ content: '', editorData: handBuilt })).toBeUndefined();
    expect(resolveMarkdownSnapshotContent({ content, editorData: null })).toBeUndefined();
  });
});
