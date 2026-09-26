import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';

import { buildFileContextMenu, type FileMenuEnv, type FileMenuTarget } from './fileContextMenu';

const t = ((key: string, options?: Record<string, unknown>) =>
  options?.trash ? `${key}(${options.trash})` : key) as unknown as TFunction<'chat'>;

const localEnv: FileMenuEnv = {
  canPaste: true,
  canPublish: false,
  canUseTerminal: true,
  isRemote: false,
  trashName: 'Trash',
};
const remoteEnv: FileMenuEnv = { ...localEnv, canUseTerminal: false, isRemote: true };

const file: FileMenuTarget = { isDeleted: false, isDirty: false, kind: 'file' };
const folder: FileMenuTarget = { isDeleted: false, isDirty: false, kind: 'folder' };
const root: FileMenuTarget = { kind: 'root' };

const keys = (target: FileMenuTarget, env: FileMenuEnv) =>
  buildFileContextMenu(target, env, vi.fn(), t).map((item) => item?.key);

describe('buildFileContextMenu', () => {
  it('gives every entry both a web icon and a native SF Symbol', () => {
    const targets: FileMenuTarget[] = [
      file,
      folder,
      root,
      { isDeleted: false, isDirty: true, kind: 'file' },
      { isDeleted: true, isDirty: true, kind: 'file' },
    ];
    for (const env of [localEnv, remoteEnv, { ...localEnv, canPublish: true }]) {
      for (const target of targets) {
        const entries = buildFileContextMenu(target, env, vi.fn(), t).filter(
          (item) => item && item.type !== 'divider',
        );
        expect(entries.length).toBeGreaterThan(0);
        for (const entry of entries) {
          expect(entry, String(entry?.key)).toHaveProperty('icon');
          expect((entry as { icon?: unknown }).icon, String(entry?.key)).toBeTruthy();
          expect((entry as { sfSymbol?: string }).sfSymbol, String(entry?.key)).toBeTruthy();
        }
      }
    }
  });

  it('builds the local file menu', () => {
    expect(keys(file, localEnv)).toEqual([
      'open',
      'divider-show-in-system',
      'show-in-system',
      'open-in-terminal',
      'divider-cut',
      'cut',
      'copy',
      'paste',
      'duplicate',
      'divider-copy-absolute-path',
      'copy-absolute-path',
      'copy-relative-path',
      'divider-rename',
      'rename',
      'trash',
    ]);
  });

  it('builds the local folder menu with create entries and "Open in System"', () => {
    const items = buildFileContextMenu(folder, localEnv, vi.fn(), t);
    expect(items.map((item) => item?.key)).toEqual([
      'new-file',
      'new-folder',
      'divider-open-in-system',
      'open-in-system',
      'show-in-system',
      'open-in-terminal',
      'divider-cut',
      'cut',
      'copy',
      'paste',
      'duplicate',
      'divider-copy-absolute-path',
      'copy-absolute-path',
      'copy-relative-path',
      'divider-rename',
      'rename',
      'trash',
    ]);
    // A folder no longer says "Open File".
    expect(items.find((item) => item?.key === 'open-in-system')).toMatchObject({
      label: 'workingPanel.files.actions.openInSystem',
    });
    expect(items.map((item) => item?.key)).not.toContain('open');
  });

  it('builds the root / blank-area menu', () => {
    expect(keys(root, localEnv)).toEqual([
      'new-file',
      'new-folder',
      'divider-paste',
      'paste',
      'divider-refresh',
      'refresh',
      'collapse-all',
      'divider-show-in-system',
      'show-in-system',
      'open-in-terminal',
      'copy-absolute-path',
    ]);
  });

  it('keeps every file operation on a remote device but drops OS-level entries', () => {
    expect(keys(file, remoteEnv)).toEqual([
      'open',
      'divider-cut',
      'cut',
      'copy',
      'paste',
      'duplicate',
      'divider-copy-absolute-path',
      'copy-absolute-path',
      'copy-relative-path',
      'divider-rename',
      'rename',
      'trash',
    ]);
    expect(keys(folder, remoteEnv)).toEqual([
      'new-file',
      'new-folder',
      'divider-cut',
      'cut',
      'copy',
      'paste',
      'duplicate',
      'divider-copy-absolute-path',
      'copy-absolute-path',
      'copy-relative-path',
      'divider-rename',
      'rename',
      'trash',
    ]);
    expect(keys(root, remoteEnv)).toEqual([
      'new-file',
      'new-folder',
      'divider-paste',
      'paste',
      'divider-refresh',
      'refresh',
      'collapse-all',
      'divider-copy-absolute-path',
      'copy-absolute-path',
    ]);
  });

  it('hides the terminal entry when the in-app terminal is unavailable', () => {
    expect(keys(folder, { ...localEnv, canUseTerminal: false })).not.toContain('open-in-terminal');
  });

  it('offers publish and review only when they apply', () => {
    expect(keys({ ...file, isDirty: true }, { ...localEnv, canPublish: true })).toEqual(
      expect.arrayContaining(['publish', 'show-in-review']),
    );
    expect(keys(file, localEnv)).not.toContain('show-in-review');
  });

  it('leaves only path and review entries on a row git reports deleted', () => {
    expect(keys({ isDeleted: true, isDirty: true, kind: 'file' }, localEnv)).toEqual([
      'show-in-review',
      'divider-copy-absolute-path',
      'copy-absolute-path',
      'copy-relative-path',
    ]);
  });

  it('disables paste when the clipboard is empty and names the platform trash', () => {
    const items = buildFileContextMenu(file, { ...localEnv, canPaste: false }, vi.fn(), t);
    expect(items.find((item) => item?.key === 'paste')).toMatchObject({ disabled: true });
    expect(items.find((item) => item?.key === 'trash')).toMatchObject({
      danger: true,
      label: 'workingPanel.files.actions.moveToTrash(Trash)',
    });
  });

  it('runs the matching action on click', () => {
    const run = vi.fn();
    const items = buildFileContextMenu(folder, localEnv, run, t);
    for (const item of items) {
      if (item && 'onClick' in item && item.onClick) (item.onClick as () => void)();
    }
    expect(run.mock.calls.map(([action]) => action)).toEqual([
      'newFile',
      'newFolder',
      'openInSystem',
      'revealInSystem',
      'openInTerminal',
      'cut',
      'copy',
      'paste',
      'duplicate',
      'copyPath',
      'copyRelativePath',
      'rename',
      'trash',
    ]);
  });
});
