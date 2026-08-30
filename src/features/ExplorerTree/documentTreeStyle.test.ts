import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_TREE_ICON_CSS,
  DOCUMENT_TREE_LAYOUT,
  DOCUMENT_TREE_ROW_CSS,
} from './documentTreeStyle';
import { FOLDER_ICON_CSS, getExplorerTreeStyleVars } from './folderIconStyle';

const MATERIAL_ASSET_HOST = '@lobehub/assets-fileicon';

// The document tree (agent documents) and the code trees (project Files, review
// diff) share one ExplorerTree component but MUST NOT share a look: documents are
// prose and get a 36px/14px monochrome outline treatment, code files keep the
// dense material icon set. These assertions are the guard rail for that split —
// they fail the moment a document-only token starts leaking into the code trees.
describe('document tree and code tree are styled independently', () => {
  it('paints the document tree with inline lucide masks, never the material sprite set', () => {
    expect(DOCUMENT_TREE_ICON_CSS).toContain('mask-image');
    expect(DOCUMENT_TREE_ICON_CSS).toContain('data:image/svg+xml');
    // No CDN sprite lookups at all — a document row must not depend on the
    // material asset package.
    expect(DOCUMENT_TREE_ICON_CSS).not.toContain(MATERIAL_ASSET_HOST);
    expect(DOCUMENT_TREE_ICON_CSS).not.toContain('background-image');
  });

  it('keeps the code tree on the material sprite set with no document overrides', () => {
    expect(FOLDER_ICON_CSS).toContain(MATERIAL_ASSET_HOST);
    expect(FOLDER_ICON_CSS).toContain('folder-open.svg');
    // Document-only presentation must not reach the Files / Review trees.
    expect(FOLDER_ICON_CSS).not.toContain('mask-image');
    expect(FOLDER_ICON_CSS).not.toContain('--explorer-tree-icon-fg');
    expect(FOLDER_ICON_CSS).not.toContain('data-truncate-segment-priority');
    expect(FOLDER_ICON_CSS).not.toContain('font-weight');
  });

  it('confines the row treatment (folder weight, focus ring, trailing ellipsis) to the document tree', () => {
    expect(DOCUMENT_TREE_ROW_CSS).toContain('font-weight: 500');
    expect(DOCUMENT_TREE_ROW_CSS).toContain('data-truncate-segment-priority');
    expect(DOCUMENT_TREE_ROW_CSS).toContain('outline: none');
    expect(FOLDER_ICON_CSS).not.toContain(DOCUMENT_TREE_ROW_CSS.trim());
  });

  it('leaves the code trees on pierre defaults for the reserved icon column', () => {
    // Files / Review call getExplorerTreeStyleVars with no metrics; the document
    // tree passes its own. Widening the document gap must not move theirs.
    expect(getExplorerTreeStyleVars({ reserveChevronSlot: true })).toEqual({
      '--explorer-file-icon-offset': '22px',
    });
    expect(
      getExplorerTreeStyleVars({
        iconWidth: DOCUMENT_TREE_LAYOUT.iconWidth,
        reserveChevronSlot: true,
        rowGap: DOCUMENT_TREE_LAYOUT.iconGap,
      }),
    ).toEqual({ '--explorer-file-icon-offset': '24px' });
  });
});

// Reading the call sites keeps this honest: asserting on the constants alone
// would still pass if a code tree started importing the document bundle.
describe('code tree call sites', () => {
  const read = (relativePath: string) =>
    readFileSync(join(__dirname, '..', '..', '..', 'src', relativePath), 'utf8');

  const CODE_TREE_FILES = [
    'features/Conversation/WorkingSidebar/Files/index.tsx',
    'features/Conversation/WorkingSidebar/Review/FileTreeNav.tsx',
  ];

  it.each(CODE_TREE_FILES)('%s renders with FOLDER_ICON_CSS and no document tokens', (file) => {
    const source = read(file);
    expect(source).toContain('FOLDER_ICON_CSS');
    expect(source).not.toContain('DOCUMENT_TREE_ICON_CSS');
    expect(source).not.toContain('DOCUMENT_TREE_ROW_CSS');
    expect(source).not.toContain('DOCUMENT_TREE_LAYOUT');
    // They keep their own pre-existing 12px label and pierre's default 30px row
    // (no `itemHeight` prop) — that is what "文件的那个 tree 渲染保留原样" means.
    // The document tree's 14px / 36px must never reach them.
    expect(source).toContain('--trees-font-size-override: 12px');
    expect(source).not.toContain('itemHeight');
  });
});
