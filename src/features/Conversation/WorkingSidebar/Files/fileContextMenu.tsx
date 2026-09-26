import type { SFSymbol } from '@lobechat/electron-client-ipc';
import type { TFunction } from 'i18next';
import type { LucideIcon } from 'lucide-react';
import {
  AppWindowIcon,
  ClipboardPasteIcon,
  CopyIcon,
  CopyPlusIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderPlusIcon,
  FolderSearchIcon,
  FoldVerticalIcon,
  GitCompareArrowsIcon,
  LinkIcon,
  PenLineIcon,
  RotateCwIcon,
  ScissorsIcon,
  Share2Icon,
  SquareTerminalIcon,
  Trash2Icon,
} from 'lucide-react';

import type { NativeContextMenuItem } from '@/libs/contextMenu/types';

/** What was right-clicked: a file or folder row, or the project root / blank area. */
export type FileMenuTarget =
  | { kind: 'root' }
  | {
      /** Git reports it deleted: the path no longer exists on disk. */
      isDeleted: boolean;
      isDirty: boolean;
      kind: 'file' | 'folder';
    };

export interface FileMenuEnv {
  /** Paste has something to paste in this scope. */
  canPaste: boolean;
  /** Publish is offered for this file (cloud, HTML only). */
  canPublish: boolean;
  /** The in-app terminal is available (desktop, local workspace). */
  canUseTerminal: boolean;
  isRemote: boolean;
  /** Platform name of the trash, already localized ("Trash" / "Recycle Bin"). */
  trashName: string;
}

export type FileMenuAction =
  | 'collapseAll'
  | 'copy'
  | 'copyPath'
  | 'copyRelativePath'
  | 'cut'
  | 'duplicate'
  | 'newFile'
  | 'newFolder'
  | 'open'
  | 'openInSystem'
  | 'openInTerminal'
  | 'paste'
  | 'publish'
  | 'refresh'
  | 'rename'
  | 'revealInSystem'
  | 'showInReview'
  | 'trash';

type Item = Exclude<NativeContextMenuItem, null>;

/**
 * Every entry carries both glyphs: `sfSymbol` for the native macOS menu and a
 * lucide `icon` for the web menu (and non-mac desktops), so the two stay alike.
 */
const ACTION_ICONS: Record<FileMenuAction, { icon: LucideIcon; sfSymbol: SFSymbol }> = {
  collapseAll: { icon: FoldVerticalIcon, sfSymbol: 'rectangle.compress.vertical' },
  copy: { icon: CopyIcon, sfSymbol: 'doc.on.doc' },
  copyPath: { icon: LinkIcon, sfSymbol: 'link' },
  copyRelativePath: { icon: LinkIcon, sfSymbol: 'link' },
  cut: { icon: ScissorsIcon, sfSymbol: 'scissors' },
  duplicate: { icon: CopyPlusIcon, sfSymbol: 'plus.square.on.square' },
  newFile: { icon: FilePlusIcon, sfSymbol: 'doc.badge.plus' },
  newFolder: { icon: FolderPlusIcon, sfSymbol: 'folder.badge.plus' },
  open: { icon: FileTextIcon, sfSymbol: 'doc' },
  openInSystem: { icon: AppWindowIcon, sfSymbol: 'arrow.up.forward.app' },
  openInTerminal: { icon: SquareTerminalIcon, sfSymbol: 'terminal' },
  paste: { icon: ClipboardPasteIcon, sfSymbol: 'doc.on.clipboard' },
  publish: { icon: Share2Icon, sfSymbol: 'square.and.arrow.up' },
  refresh: { icon: RotateCwIcon, sfSymbol: 'arrow.clockwise' },
  rename: { icon: PenLineIcon, sfSymbol: 'pencil' },
  revealInSystem: { icon: FolderSearchIcon, sfSymbol: 'folder' },
  showInReview: { icon: GitCompareArrowsIcon, sfSymbol: 'arrow.triangle.branch' },
  trash: { icon: Trash2Icon, sfSymbol: 'trash' },
};

const joinGroups = (groups: Item[][]): NativeContextMenuItem[] => {
  const items: NativeContextMenuItem[] = [];
  for (const group of groups) {
    if (group.length === 0) continue;
    if (items.length > 0) items.push({ key: `divider-${group[0].key}`, type: 'divider' });
    items.push(...group);
  }
  return items;
};

/**
 * Context menu of the Files tree, per target (file / folder / root and blank
 * area) and per host (local desktop vs remote device). OS-level entries
 * (reveal, open in system, terminal) only exist for a local workspace; a
 * remote device keeps every file operation and reports at run time when its
 * client can't perform one. Keys stay stable for tests and telemetry.
 */
export const buildFileContextMenu = (
  target: FileMenuTarget,
  env: FileMenuEnv,
  run: (action: FileMenuAction) => void,
  t: TFunction<'chat'>,
): NativeContextMenuItem[] => {
  const item = (key: string, action: FileMenuAction, label: string, extra?: Partial<Item>) => {
    const { icon: IconComponent, sfSymbol } = ACTION_ICONS[action];
    return {
      icon: <IconComponent size={14} />,
      key,
      label,
      onClick: () => run(action),
      sfSymbol,
      ...extra,
    } as Item;
  };
  const local = !env.isRemote;

  const copyPathItem = item(
    'copy-absolute-path',
    'copyPath',
    t('workingPanel.files.copyAbsolutePath'),
  );
  const pasteItem = item('paste', 'paste', t('workingPanel.files.actions.paste'), {
    disabled: !env.canPaste,
  } as Partial<Item>);
  const newItems = [
    item('new-file', 'newFile', t('workingPanel.files.actions.newFile')),
    item('new-folder', 'newFolder', t('workingPanel.files.actions.newFolder')),
  ];

  if (target.kind === 'root') {
    return joinGroups([
      newItems,
      [pasteItem],
      [
        item('refresh', 'refresh', t('workingPanel.files.actions.refresh')),
        item('collapse-all', 'collapseAll', t('workingPanel.files.collapseAll')),
      ],
      [
        ...(local
          ? [item('show-in-system', 'revealInSystem', t('workingPanel.files.showInSystem'))]
          : []),
        ...(local && env.canUseTerminal
          ? [
              item(
                'open-in-terminal',
                'openInTerminal',
                t('workingPanel.files.actions.openInTerminal'),
              ),
            ]
          : []),
        copyPathItem,
      ],
    ]);
  }

  const isFolder = target.kind === 'folder';
  const reviewItems = target.isDirty
    ? [item('show-in-review', 'showInReview', t('workingPanel.files.showInReview'))]
    : [];
  const pathItems = [
    copyPathItem,
    item('copy-relative-path', 'copyRelativePath', t('workingPanel.files.copyRelativePath')),
  ];

  // Nothing exists on disk to open, move or delete: keep the path and review.
  if (target.isDeleted) return joinGroups([reviewItems, pathItems]);

  const openGroup = isFolder
    ? newItems
    : [
        item('open', 'open', t('workingPanel.files.open')),
        ...(env.canPublish
          ? [item('publish', 'publish', t('workingPanel.localFile.publish.action'))]
          : []),
      ];
  const systemGroup = [
    ...(local && isFolder
      ? [item('open-in-system', 'openInSystem', t('workingPanel.files.actions.openInSystem'))]
      : []),
    ...(local
      ? [item('show-in-system', 'revealInSystem', t('workingPanel.files.showInSystem'))]
      : []),
    ...(local && env.canUseTerminal
      ? [item('open-in-terminal', 'openInTerminal', t('workingPanel.files.actions.openInTerminal'))]
      : []),
    ...reviewItems,
  ];

  return joinGroups([
    openGroup,
    systemGroup,
    [
      item('cut', 'cut', t('workingPanel.files.actions.cut')),
      item('copy', 'copy', t('workingPanel.files.actions.copy')),
      pasteItem,
      item('duplicate', 'duplicate', t('workingPanel.files.actions.duplicate')),
    ],
    pathItems,
    [
      item('rename', 'rename', t('workingPanel.files.actions.rename')),
      item(
        'trash',
        'trash',
        t('workingPanel.files.actions.moveToTrash', { trash: env.trashName }),
        {
          danger: true,
        } as Partial<Item>,
      ),
    ],
  ]);
};
