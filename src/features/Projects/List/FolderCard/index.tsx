'use client';

import { ActionIcon, ContextMenuTrigger, DropdownMenu, Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { MoreHorizontalIcon, StarIcon } from 'lucide-react';
import { Fragment, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFavoriteToggle } from '@/features/Favorites';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import type { ProjectListItem } from '@/store/project';
import { useProjectOverview, useProjectOverviewsLoaded } from '@/store/project';

import { projectFavoriteTarget } from '../../projectFavorite';
import { useProjectMenuItems } from '../useProjectMenuItems';
import { AgentStack } from './AgentStack';
import { FolderPaper } from './FolderPaper';
import { isRichFolder, resolveFolderSheet } from './folderSheet';
import { folderCardMarker } from './markers.stylex';

const PAPER_EASE = 'cubic-bezier(.2,.8,.2,1)';
const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';

const styles = stylex.create({
  actions: {
    // Over the pocket's top-right corner, beside the project name.
    insetBlockStart: 207,
    insetInlineEnd: 12,
    opacity: {
      'default': 0,
      '@media (hover: none)': 1,
      [stylex.when.ancestor(':hover', folderCardMarker)]: 1,
      [stylex.when.ancestor(':focus-within', folderCardMarker)]: 1,
    },
    position: 'absolute',
    transitionDuration: cssVar.motionDurationFast,
    transitionProperty: 'opacity',
    zIndex: 2,
  },
  back: {
    backgroundColor: cssVar.colorFillTertiary,
    borderColor: cssVar.colorBorderSecondary,
    borderStyle: 'solid',
    borderWidth: 1,
    borderEndEndRadius: 16,
    borderEndStartRadius: 16,
    borderStartEndRadius: 16,
    borderStartStartRadius: 4,
    insetBlockEnd: 0,
    insetBlockStart: 8,
    insetInline: 0,
    position: 'absolute',
  },
  dot: {
    backgroundColor: cssVar.colorInfo,
    borderRadius: '50%',
    display: 'inline-block',
    flexShrink: 0,
    height: 7,
    width: 7,
  },
  link: {
    borderRadius: 16,
    color: 'inherit',
    display: 'block',
    insetBlock: 0,
    insetInline: 0,
    outline: {
      'default': 'none',
      ':focus-visible': `2px solid ${cssVar.colorPrimaryBorder}`,
    },
    outlineOffset: 4,
    position: 'absolute',
  },
  meta: {
    alignItems: 'center',
    color: cssVar.colorTextSecondary,
    display: 'flex',
    fontSize: 12,
    gap: 8,
    minWidth: 0,
    whiteSpace: 'nowrap',
  },
  metaFill: {
    flex: '1',
  },
  name: {
    color: cssVar.colorText,
    fontSize: 16,
    fontWeight: 600,
    letterSpacing: '-0.01em',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  identifier: {
    color: cssVar.colorTextQuaternary,
    flexShrink: 0,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 11,
  },
  nameRow: {
    alignItems: 'baseline',
    display: 'flex',
    gap: 8,
    minWidth: 0,
    // Leaves room for the more-actions button over the pocket's corner.
    paddingInlineEnd: 28,
  },
  paper: {
    backgroundColor: cssVar.colorBgElevated,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 10,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: cssVar.boxShadowTertiary,
    height: 212,
    insetBlockStart: 22,
    insetInline: 16,
    overflow: 'hidden',
    position: 'absolute',
    transform: {
      default: null,
      [stylex.when.ancestor(':hover', folderCardMarker)]: 'translateY(-6px)',
      [stylex.when.ancestor(':focus-within', folderCardMarker)]: 'translateY(-6px)',
    },
    transitionDuration: { default: cssVar.motionDurationMid, [REDUCED_MOTION]: '0s' },
    transitionProperty: 'transform',
    transitionTimingFunction: PAPER_EASE,
  },
  paperBehind: {
    backgroundColor: cssVar.colorBgContainer,
    boxShadow: 'none',
    insetBlockStart: 14,
    insetInline: 28,
    transform: {
      default: null,
      [stylex.when.ancestor(':hover', folderCardMarker)]: 'translateY(-9px)',
      [stylex.when.ancestor(':focus-within', folderCardMarker)]: 'translateY(-9px)',
    },
  },
  pocket: {
    backdropFilter: 'blur(16px) saturate(1.2)',
    backgroundColor: `color-mix(in srgb, ${cssVar.colorBgLayout} 78%, transparent)`,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 16,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'flex',
    flexDirection: 'column',
    height: 104,
    insetBlockEnd: 0,
    insetInline: 0,
    justifyContent: 'space-between',
    paddingBlockEnd: 14,
    paddingBlockStart: 16,
    paddingInline: 18,
    position: 'absolute',
  },
  root: {
    height: 300,
    position: 'relative',
  },
  sep: {
    backgroundColor: cssVar.colorTextQuaternary,
    borderRadius: '50%',
    flexShrink: 0,
    height: 2,
    width: 2,
  },
  star: {
    flexShrink: 0,
    marginInlineStart: 'auto',
  },
  tab: {
    backgroundColor: cssVar.colorFillTertiary,
    borderBlockEndWidth: 0,
    borderColor: cssVar.colorBorderSecondary,
    borderStartEndRadius: 12,
    borderStartStartRadius: 12,
    borderStyle: 'solid',
    borderWidth: 1,
    height: 20,
    insetBlockStart: 0,
    insetInlineStart: 0,
    position: 'absolute',
    width: '40%',
  },
});

interface FolderCardProps {
  project: ProjectListItem;
}

/**
 * A project as a folder: a back panel with a tab, the project's latest content
 * on a paper inside, and a frosted pocket in front with its name and numbers.
 */
export const FolderCard = memo<FolderCardProps>(({ project }) => {
  const { t } = useTranslation('project');
  const overview = useProjectOverview(project.id);
  const overviewsLoaded = useProjectOverviewsLoaded();
  const { deleting, menuItems } = useProjectMenuItems(project);
  const { isFavorite } = useFavoriteToggle(projectFavoriteTarget(project));

  const sheet = resolveFolderSheet(overview, overviewsLoaded);
  const rich = isRichFolder(overview);
  const running = project.status === 'active';
  const showCounts = overviewsLoaded;
  const topicCount = overview?.topicCount ?? 0;
  const taskCount = overview?.taskCount ?? 0;

  const metaItems = [
    showCounts &&
      (topicCount > 0
        ? t('list.folder.topicCount', { count: topicCount })
        : t('list.folder.noTopics')),
    showCounts &&
      taskCount > 0 &&
      t('list.folder.taskProgress', { done: overview?.taskDoneCount ?? 0, total: taskCount }),
  ].filter((item): item is string => !!item);

  return (
    <ContextMenuTrigger items={menuItems}>
      <div {...stylex.props(styles.root, folderCardMarker)}>
        <div {...stylex.props(styles.back)} />
        <div {...stylex.props(styles.tab)} />
        {rich && <div {...stylex.props(styles.paper, styles.paperBehind)} />}
        <div {...stylex.props(styles.paper)}>
          <FolderPaper project={project} sheet={sheet} />
        </div>
        <WorkspaceLink
          aria-label={project.name}
          to={`/project/${project.slug ?? project.id}`}
          {...stylex.props(styles.link)}
        >
          <div {...stylex.props(styles.pocket)}>
            <div {...stylex.props(styles.nameRow)}>
              <span {...stylex.props(styles.name)}>{project.name}</span>
              <span {...stylex.props(styles.identifier)}>{project.identifier}</span>
              {isFavorite && (
                <span {...stylex.props(styles.star)}>
                  <Icon
                    color={cssVar.colorWarning}
                    fill={cssVar.colorWarning}
                    icon={StarIcon}
                    size={13}
                  />
                </span>
              )}
            </div>
            <div {...stylex.props(styles.meta)}>
              {running && (
                <Tooltip title={t('list.folder.running')}>
                  <span aria-label={t('list.folder.running')} {...stylex.props(styles.dot)} />
                </Tooltip>
              )}
              {metaItems.map((item, index) => (
                <Fragment key={index}>
                  {index > 0 && <span {...stylex.props(styles.sep)} />}
                  <span>{item}</span>
                </Fragment>
              ))}
              <span {...stylex.props(styles.metaFill)} />
              <AgentStack agents={overview?.agents} project={project} />
              <span title={dayjs(project.updatedAt).format('YYYY-MM-DD HH:mm')}>
                {dayjs(project.updatedAt).fromNow()}
              </span>
            </div>
          </div>
        </WorkspaceLink>
        <span {...stylex.props(styles.actions)}>
          <DropdownMenu items={menuItems} placement={'bottomRight'}>
            <ActionIcon
              icon={MoreHorizontalIcon}
              loading={deleting}
              size={'small'}
              title={t('list.moreActions')}
            />
          </DropdownMenu>
        </span>
      </div>
    </ContextMenuTrigger>
  );
});

FolderCard.displayName = 'FolderCard';
