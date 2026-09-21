'use client';

import type { ProjectFileIndexEntry } from '@lobechat/electron-client-ipc';
import { type DropdownItem, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronRightIcon } from 'lucide-react';
import { memo, useMemo } from 'react';

import FileIcon from '@/components/FileIcon';
import { useProjectFiles } from '@/features/Conversation/WorkingSidebar/Files/useProjectFiles';
import { useChatStore } from '@/store/chat';

import {
  type BreadcrumbSegment,
  groupChildrenByParent,
  toBreadcrumbSegments,
} from './filePathBreadcrumb';

const styles = createStaticStyles(({ css }) => ({
  crumb: css`
    cursor: pointer;

    overflow: hidden;

    min-width: 0;
    padding-block: 2px;
    padding-inline: 4px;
    border: none;
    border-radius: ${cssVar.borderRadiusSM};

    font-family: inherit;
    font-size: inherit;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: none;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  crumbStatic: css`
    cursor: default;

    &:hover {
      color: ${cssVar.colorTextTertiary};
      background: none;
    }
  `,
  /* The previewed file is the crumb a reader always needs in full, so it is the
     last one to give up width. */
  group: css`
    overflow: hidden;
    flex-shrink: 1;
    min-width: 0;
  `,
  groupLast: css`
    flex-shrink: 0;

    span {
      color: ${cssVar.colorText};
    }
  `,
  separator: css`
    display: flex;
    flex: none;
    align-items: center;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

interface BuildMenuParams {
  byParent: Map<string, ProjectFileIndexEntry[]>;
  deviceId?: string;
  openFile: (filePath: string) => void;
  parentRelativePath: string;
}

/**
 * The contents of one folder as menu items: files open the preview, folders
 * become submenus of their own contents, so the breadcrumb walks the tree the
 * way a desktop editor's does.
 *
 * A folder with nothing indexed under it is left out rather than rendered as an
 * empty submenu — there would be nothing to pick.
 */
const buildFolderItems = ({
  byParent,
  deviceId,
  openFile,
  parentRelativePath,
}: BuildMenuParams): DropdownItem[] => {
  const children = byParent.get(parentRelativePath) ?? [];

  return children.flatMap((child): DropdownItem[] => {
    const relativePath = child.relativePath.replace(/\/$/, '');
    const icon = (
      <FileIcon fileName={child.name} isDirectory={child.isDirectory} size={14} variant={'raw'} />
    );

    if (!child.isDirectory) {
      return [{ icon, key: child.path, label: child.name, onClick: () => openFile(child.path) }];
    }

    const grandChildren = buildFolderItems({
      byParent,
      deviceId,
      openFile,
      parentRelativePath: relativePath,
    });
    if (grandChildren.length === 0) return [];

    return [
      {
        children: grandChildren,
        icon,
        key: child.path,
        label: child.name,
        openOnHover: true,
        type: 'submenu',
      },
    ];
  });
};

/**
 * One level of the path. A level backed by the project index opens a menu of
 * that folder's contents, so the breadcrumb doubles as a file switcher.
 */
const Crumb = memo<{
  byParent?: Map<string, ProjectFileIndexEntry[]>;
  deviceId?: string;
  isLast: boolean;
  rootPath?: string;
  segment: BreadcrumbSegment;
}>(({ byParent, deviceId, isLast, rootPath, segment }) => {
  const openLocalFile = useChatStore((s) => s.openLocalFile);

  const ownFolder = useMemo(() => {
    if (segment.relativePath === undefined) return;
    // The last crumb is the previewed file, so its menu lists its siblings.
    return isLast ? segment.relativePath.split('/').slice(0, -1).join('/') : segment.relativePath;
  }, [isLast, segment.relativePath]);

  const items = useMemo(() => {
    if (!byParent || !rootPath || ownFolder === undefined) return [];

    return buildFolderItems({
      byParent,
      deviceId,
      openFile: (filePath) => openLocalFile({ deviceId, filePath, workingDirectory: rootPath }),
      parentRelativePath: ownFolder,
    });
  }, [byParent, deviceId, openLocalFile, ownFolder, rootPath]);

  // A folder on the path holds at least the open file, so an empty result means
  // the index does not reach here — a project past the walk's cap.
  const canBrowse = items.length > 0;

  // A span rather than a button: the menu's trigger applies its own button
  // semantics, and base-ui rejects a native button as the element it renders.
  const crumb = (
    <span className={cx(styles.crumb, !canBrowse && styles.crumbStatic)}>{segment.name}</span>
  );

  if (!canBrowse) return crumb;

  return <DropdownMenu items={items}>{crumb}</DropdownMenu>;
});

Crumb.displayName = 'Crumb';

interface PathBreadcrumbProps {
  deviceId?: string;
  path: string;
  rootPath?: string;
}

const PathBreadcrumb = memo<PathBreadcrumbProps>(({ deviceId, path, rootPath }) => {
  const { data } = useProjectFiles(deviceId, rootPath);
  const segments = useMemo(() => toBreadcrumbSegments(path, rootPath), [path, rootPath]);
  const byParent = useMemo(
    () => (data?.entries ? groupChildrenByParent(data.entries) : undefined),
    [data?.entries],
  );

  return (
    <>
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;

        return (
          <Flexbox
            horizontal
            align={'center'}
            className={cx(styles.group, isLast && styles.groupLast)}
            key={segment.path}
          >
            {index > 0 && (
              <span aria-hidden className={styles.separator}>
                <Icon icon={ChevronRightIcon} size={12} />
              </span>
            )}
            <Crumb
              byParent={byParent}
              deviceId={deviceId}
              isLast={isLast}
              rootPath={rootPath}
              segment={segment}
            />
          </Flexbox>
        );
      })}
    </>
  );
});

PathBreadcrumb.displayName = 'PathBreadcrumb';

export default PathBreadcrumb;
