'use client';

import type { ProjectFileIndexEntry } from '@lobechat/electron-client-ipc';
import { type DropdownItem, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

const styles = stylex.create({
  crumb: {
    cursor: 'pointer',
    overflow: 'hidden',
    minWidth: 0,
    paddingBlock: '2px',
    paddingInline: '4px',
    borderStyle: 'none',
    borderRadius: cssVar.borderRadiusSM,
    fontFamily: 'inherit',
    fontSize: 'inherit',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
  },
  // The previewed file's crumb reads in full-strength text.
  crumbLast: { color: cssVar.colorText },
  crumbStatic: {
    cursor: 'default',
    color: cssVar.colorTextTertiary,
    backgroundColor: 'transparent',
  },
  crumbStaticLast: {
    color: { 'default': cssVar.colorText, ':hover': cssVar.colorTextTertiary },
  },
  // The previewed file is the crumb a reader always needs in full, so it is the
  // last one to give up width.
  group: { overflow: 'hidden', flexShrink: 1, minWidth: 0 },
  groupLast: { flexShrink: 0 },
  separator: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    color: cssVar.colorTextQuaternary,
  },
  separatorLast: { color: cssVar.colorText },
});

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
    <span
      {...stylex.props(
        styles.crumb,
        isLast && styles.crumbLast,
        !canBrowse && styles.crumbStatic,
        !canBrowse && isLast && styles.crumbStaticLast,
      )}
    >
      {segment.name}
    </span>
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
            className={stylex.props(styles.group, isLast && styles.groupLast).className}
            key={segment.path}
          >
            {index > 0 && (
              <span aria-hidden {...stylex.props(styles.separator, isLast && styles.separatorLast)}>
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
