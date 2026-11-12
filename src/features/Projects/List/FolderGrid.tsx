'use client';

import { type DropdownItem, DropdownMenu, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ProjectListItem } from '@/store/project';

import { FolderCard } from './FolderCard';
import type { OverviewStatus } from './FolderCard/folderSheet';
import SortableProjectRows from './SortableProjectRows';

const styles = stylex.create({
  create: {
    alignItems: 'center',
    appearance: 'none',
    backgroundColor: {
      'default': 'transparent',
      ':hover': cssVar.colorFillQuaternary,
    },
    borderColor: cssVar.colorBorder,
    borderRadius: 16,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    color: cssVar.colorTextTertiary,
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    font: 'inherit',
    gap: 10,
    height: 286,
    justifyContent: 'center',
    marginBlockStart: 14,
    padding: 0,
    transitionDuration: cssVar.motionDurationFast,
    transitionProperty: 'background-color',
    width: '100%',
  },
  createIcon: {
    alignItems: 'center',
    backgroundColor: cssVar.colorFillTertiary,
    borderRadius: 12,
    color: cssVar.colorTextSecondary,
    display: 'flex',
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  grid: {
    display: 'grid',
    columnGap: 28,
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    rowGap: 36,
  },
  skeleton: {
    backgroundColor: cssVar.colorFillQuaternary,
    borderRadius: 16,
    height: 300,
  },
});

const SKELETON_CARDS = 6;

/** Placeholder folders while the project list first loads. */
export const FolderGridSkeleton = () => (
  <div aria-hidden {...stylex.props(styles.grid)}>
    {Array.from({ length: SKELETON_CARDS }, (_, index) => (
      <div key={index} {...stylex.props(styles.skeleton)} />
    ))}
  </div>
);

interface FolderGridProps {
  createMenuItems: DropdownItem[];
  /** Cards can be dragged into the shared custom order. */
  draggable: boolean;
  overviewStatus: OverviewStatus;
  projects: ProjectListItem[];
}

/** Projects as folder cards, ending with a card that creates one. */
export const FolderGrid = ({
  createMenuItems,
  draggable,
  overviewStatus,
  projects,
}: FolderGridProps) => {
  const { t } = useTranslation('project');

  return (
    <div {...stylex.props(styles.grid)}>
      {draggable ? (
        <SortableProjectRows
          layout={'grid'}
          projects={projects}
          renderRow={(project) => <FolderCard overviewStatus={overviewStatus} project={project} />}
        />
      ) : (
        projects.map((project) => (
          <FolderCard key={project.id} overviewStatus={overviewStatus} project={project} />
        ))
      )}
      <DropdownMenu items={createMenuItems} placement={'bottom'}>
        <button type={'button'} {...stylex.props(styles.create)}>
          <span {...stylex.props(styles.createIcon)}>
            <Icon icon={PlusIcon} size={20} />
          </span>
          {t('create.action')}
        </button>
      </DropdownMenu>
    </div>
  );
};
