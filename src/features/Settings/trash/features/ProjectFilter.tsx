'use client';

import type { TrashProjectFilter } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { controlHeight, Select, type SelectOptions, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { FolderKanbanIcon, LockIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import type { ProjectListItem } from '@/store/project';

import {
  fromProjectFilterValue,
  PROJECT_FILTER_ALL,
  PROJECT_FILTER_NONE,
  toProjectFilterValue,
} from './projectFilterState';

/**
 * The picker sits beside the type Segmented in one filter row, so it takes
 * that track's height (`controlHeight.middle`), radius and surface while
 * keeping the small control's 12px text. Open / hover feedback stays.
 */
const styles = createStaticStyles(({ css }) => ({
  trigger: css`
    min-height: ${controlHeight.middle}px;
    border-color: ${cssVar.colorFillQuaternary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgLayout};

    &:hover {
      border-color: ${cssVar.colorBorderSecondary};
      background: ${cssVar.colorBgLayout};
    }
  `,
}));

interface ProjectFilterProps {
  error?: unknown;
  isValidating: boolean;
  onChange: (projectId: TrashProjectFilter) => void;
  /** Re-read the live project list (names, access) whenever the picker opens. */
  onOpen: () => void;
  onRetry: () => void;
  /** The live project list of the current scope; `undefined` until it loads. */
  projects?: ProjectListItem[];
  unavailable: boolean;
  value: TrashProjectFilter;
}

export const ProjectFilter = ({
  error,
  isValidating,
  onChange,
  onOpen,
  onRetry,
  projects,
  unavailable,
  value,
}: ProjectFilterProps) => {
  const { t } = useTranslation('setting');

  const projectOptions = (projects ?? []).map((project) => ({
    label: (
      <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
        <Text ellipsis style={{ minWidth: 0 }}>
          {project.name}
        </Text>
        {/* Names are not unique; the identifier tells same-named projects apart. */}
        <Text fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
          {project.identifier}
        </Text>
        {project.visibility === 'private' && (
          <Icon color={cssVar.colorTextTertiary} icon={LockIcon} size={12} />
        )}
      </Flexbox>
    ),
    // Search matches the name and the identifier.
    title: `${project.name} ${project.identifier}`,
    value: project.id,
  }));

  const options: SelectOptions = [
    { label: t('trash.filter.project.all'), value: PROJECT_FILTER_ALL },
    { label: t('trash.filter.project.none'), value: PROJECT_FILTER_NONE },
  ];
  // Until the list loads (or while it fails) there is no project group to show.
  if (projects) {
    options.push({
      label: t('trash.filter.project.group'),
      options:
        projects.length === 0
          ? [{ disabled: true, label: t('trash.filter.project.empty'), value: '__empty__' }]
          : projectOptions,
    });
  }
  // A selected project that is gone keeps the view restricted, without its name.
  if (unavailable && typeof value === 'string') {
    options.push({ disabled: true, label: t('trash.filter.project.unavailable'), value });
  }

  return (
    <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
      <Select
        showSearch
        aria-label={t('trash.filter.project.label')}
        className={styles.trigger}
        loading={!projects && isValidating}
        options={options}
        popupMatchSelectWidth={280}
        prefix={FolderKanbanIcon}
        size={'small'}
        style={{ maxWidth: 260, minWidth: 160 }}
        // Not `virtual`: the virtual list counts the whole project group as one
        // row and crashes once search shrinks the options; search is the way
        // through a long list.
        value={toProjectFilterValue(value)}
        onChange={(next) => {
          if (typeof next === 'string') onChange(fromProjectFilterValue(next));
        }}
        onOpenChange={(open) => {
          if (open) onOpen();
        }}
      />
      {!projects && !!error && (
        // Keeps its own width: the filter row wraps before the message squeezes.
        <div style={{ flex: 'none', whiteSpace: 'nowrap' }}>
          <AsyncError
            error={error}
            retrying={isValidating}
            title={t('trash.filter.project.loadFailed')}
            variant={'inline'}
            onRetry={onRetry}
          />
        </div>
      )}
    </Flexbox>
  );
};
