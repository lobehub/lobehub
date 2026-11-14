'use client';

import { ContextMenuTrigger, Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { StarIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFavoriteToggle } from '@/features/Favorites';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useIsDark } from '@/hooks/useIsDark';
import type { ProjectListItem } from '@/store/project';
import { useProjectOverview } from '@/store/project';

import { projectFavoriteTarget } from '../../projectFavorite';
import { useProjectMenuItems } from '../useProjectMenuItems';
import { FolderCardActions } from './Actions';
import { AgentStack } from './AgentStack';
import { FolderPaper } from './FolderPaper';
import { isRichFolder, type OverviewStatus, resolveFolderSheet } from './folderSheet';
import { folderCardMarker } from './markers.stylex';

const PAPER_EASE = 'cubic-bezier(.2,.8,.2,1)';
const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';
// Light mode keeps three tones apart so the card does not wash into the white
// page: a grey folder, a lighter pocket in front of it, and the paper as the
// only near-white surface, a shade off pure white. All opaque, so the tab laid
// over the back panel joins it without a darker overlap.
const FOLDER_COLOR = `color-mix(in srgb, ${cssVar.colorText} 8%, ${cssVar.colorBgContainer})`;
const POCKET_COLOR = `color-mix(in srgb, ${cssVar.colorText} 6%, ${cssVar.colorBgContainer})`;
const PAPER_COLOR = `color-mix(in srgb, ${cssVar.colorText} 2%, ${cssVar.colorBgContainer})`;
const PAPER_BEHIND_COLOR = `color-mix(in srgb, ${cssVar.colorText} 4%, ${cssVar.colorBgContainer})`;
// Dark mode keeps the light layering: a recessed folder, the paper as the
// brightest surface, and a pocket close to the page.
const FOLDER_COLOR_DARK = `color-mix(in srgb, ${cssVar.colorBgLayout} 50%, ${cssVar.colorBgContainer})`;

const styles = stylex.create({
  back: {
    backgroundColor: FOLDER_COLOR,
    borderColor: cssVar.colorBorder,
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
  backDark: {
    backgroundColor: FOLDER_COLOR_DARK,
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
    backgroundColor: PAPER_COLOR,
    borderColor: cssVar.colorBorder,
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
    backgroundColor: PAPER_BEHIND_COLOR,
    boxShadow: 'none',
    insetBlockStart: 14,
    insetInline: 28,
    transform: {
      default: null,
      [stylex.when.ancestor(':hover', folderCardMarker)]: 'translateY(-9px)',
      [stylex.when.ancestor(':focus-within', folderCardMarker)]: 'translateY(-9px)',
    },
  },
  paperBehindDark: {
    backgroundColor: cssVar.colorBgElevated,
  },
  paperDark: {
    backgroundColor: `color-mix(in srgb, ${cssVar.colorText} 8%, ${cssVar.colorBgElevated})`,
  },
  // Opaque, without a backdrop blur: the papers slide up behind the pocket on
  // hover, and a blur over them repaints the strip on every frame of that slide.
  pocket: {
    backgroundColor: POCKET_COLOR,
    borderColor: cssVar.colorBorder,
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
  pocketDark: {
    backgroundColor: cssVar.colorBgContainer,
  },
  root: {
    height: 300,
    position: 'relative',
  },
  star: {
    alignSelf: 'center',
    display: 'inline-flex',
    flexShrink: 0,
    marginInlineEnd: -4,
  },
  tab: {
    backgroundColor: FOLDER_COLOR,
    borderBlockEndWidth: 0,
    borderColor: cssVar.colorBorder,
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
  /** Where the page's overview batch stands; the page owns the fetch and its error. */
  overviewStatus: OverviewStatus;
  project: ProjectListItem;
}

/**
 * A project as a folder: a back panel with a tab, the project's latest content
 * on a paper inside, and a pocket in front with its name and numbers.
 */
export const FolderCard = memo<FolderCardProps>(({ overviewStatus, project }) => {
  const { t } = useTranslation('project');
  const overview = useProjectOverview(project.id);
  const { deleting, menuItems } = useProjectMenuItems(project);
  const { isFavorite } = useFavoriteToggle(projectFavoriteTarget(project));
  const isDark = useIsDark();

  const sheet = resolveFolderSheet(overview, overviewStatus);
  const rich = isRichFolder(overview);
  const running = project.status === 'active';
  const showCounts = overviewStatus === 'loaded';
  const taskCount = overview?.taskCount ?? 0;
  const taskSummary = showCounts
    ? taskCount > 0
      ? t('list.folder.taskProgress', { done: overview?.taskDoneCount ?? 0, total: taskCount })
      : t('list.folder.noTasks')
    : undefined;

  return (
    <ContextMenuTrigger items={menuItems}>
      <div {...stylex.props(styles.root, folderCardMarker)}>
        <div {...stylex.props(styles.back, isDark && styles.backDark)} />
        <div {...stylex.props(styles.tab, isDark && styles.backDark)} />
        {rich && (
          <div
            {...stylex.props(
              styles.paper,
              isDark && styles.paperDark,
              styles.paperBehind,
              isDark && styles.paperBehindDark,
            )}
          />
        )}
        <div {...stylex.props(styles.paper, isDark && styles.paperDark)}>
          <FolderPaper project={project} sheet={sheet} />
        </div>
        <WorkspaceLink
          aria-label={project.name}
          to={`/project/${project.slug ?? project.id}`}
          {...stylex.props(styles.link)}
        >
          <div {...stylex.props(styles.pocket, isDark && styles.pocketDark)}>
            <div {...stylex.props(styles.nameRow)}>
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
              <span {...stylex.props(styles.name)}>{project.name}</span>
              <span {...stylex.props(styles.identifier)}>{project.identifier}</span>
            </div>
            <div {...stylex.props(styles.meta)}>
              {running && (
                <Tooltip title={t('list.folder.running')}>
                  <span aria-label={t('list.folder.running')} {...stylex.props(styles.dot)} />
                </Tooltip>
              )}
              {taskSummary && <span>{taskSummary}</span>}
              <span {...stylex.props(styles.metaFill)} />
              <AgentStack agents={overview?.agents} project={project} />
              <span title={dayjs(project.updatedAt).format('YYYY-MM-DD HH:mm')}>
                {dayjs(project.updatedAt).fromNow()}
              </span>
            </div>
          </div>
        </WorkspaceLink>
        <FolderCardActions deleting={deleting} menuItems={menuItems} />
      </div>
    </ContextMenuTrigger>
  );
});

FolderCard.displayName = 'FolderCard';
