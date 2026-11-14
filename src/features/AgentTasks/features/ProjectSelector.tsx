import { Button, cssVar, Flexbox, Icon, Popover, Text, Tooltip } from '@lobehub/ui';
import { cssVar as sxVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckIcon, FolderXIcon } from 'lucide-react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import ProjectAvatar from '@/features/Projects/ProjectAvatar';
import { resolveProjectListState } from '@/features/Projects/projectListState';
import { usePermission } from '@/hooks/usePermission';
import { type ProjectListItem, useCurrentProjectList, useProjectStore } from '@/store/project';
import { useTaskStore } from '@/store/task';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { filterProjectsByName } from './projectSelectorModel';

const styles = stylex.create({
  searchInput: {
    'width': '100%',
    'paddingBlock': 6,
    'paddingInline': 10,
    'borderWidth': 0,
    'borderBlockEndWidth': 1,
    'borderBlockEndStyle': 'solid',
    'borderBlockEndColor': sxVar.colorBorderSecondary,
    'fontFamily': 'inherit',
    'fontSize': 13,
    'color': sxVar.colorText,
    'backgroundColor': 'transparent',
    'outline': 'none',
    '::placeholder': { color: sxVar.colorTextPlaceholder },
  },
});

const triggerStyle: CSSProperties = {
  alignItems: 'center',
  display: 'inline-flex',
  maxWidth: '100%',
  minWidth: 0,
};

// Keeps the disabled wrapper out of layout, so the trigger sits as when enabled.
const blockedContentStyle: CSSProperties = { display: 'contents', pointerEvents: 'none' };

const NONE_KEY = '__none__';

type ProjectOption =
  { key: string; kind: 'none' } | { key: string; kind: 'project'; project: ProjectListItem };

interface ProjectSelectorProps {
  children: ReactNode;
  /** Makes the picker read-only for a reason other than permission. */
  disabledReason?: string;
  fullWidth?: boolean;
  /** Reports the pick instead of saving it, for a composer holding it in a draft. */
  onChange?: (projectId: string | null) => void;
  /** The task a pick is saved to when there is no `onChange`. */
  taskIdentifier?: string;
  value?: string | null;
}

/**
 * Single-select project picker over the current workspace's projects: search by
 * name, arrow keys + Enter to pick, Esc to close. Renders nothing while the
 * Projects lab is off, so no host can offer a feature the user has not enabled.
 */
const ProjectSelector = memo<ProjectSelectorProps>(
  ({ children, disabledReason, fullWidth, onChange, taskIdentifier, value }) => {
    const { t } = useTranslation('chat');
    const enabled = useUserStore(labPreferSelectors.enableProjects);
    const { allowed: canEdit, reason } = usePermission('create_content');
    const updateTask = useTaskStore((s) => s.updateTask);

    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    const { error, isHydrated, isValidating, revalidate } = useProjectStore(
      (s) => s.useFetchProjectList,
    )(enabled);
    const projects = useCurrentProjectList();
    // An empty list is only "no projects" once the fetch has settled.
    const listState = resolveProjectListState({
      error,
      isHydrated,
      isValidating,
      projects: projects.length > 0 ? projects : undefined,
    });

    const query = search.trim();
    const noneLabel = t('taskProject.none');
    const matches = useMemo(() => filterProjectsByName(projects, query), [projects, query]);
    const options = useMemo<ProjectOption[]>(() => {
      const showNone = !query || noneLabel.toLowerCase().includes(query.toLowerCase());
      return [
        ...(showNone ? [{ key: NONE_KEY, kind: 'none' as const }] : []),
        ...matches.map((project) => ({ key: project.id, kind: 'project' as const, project })),
      ];
    }, [matches, noneLabel, query]);
    const selectedKey = value ?? NONE_KEY;

    // Rest on the current project when opening; a search starts from the top match.
    useEffect(() => {
      if (query) {
        setActiveIndex(0);
        return;
      }
      const selectedIndex = options.findIndex((option) => option.key === selectedKey);
      setActiveIndex(Math.max(selectedIndex, 0));
    }, [open, options, query, selectedKey]);

    useEffect(() => {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-project-index="${activeIndex}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex]);

    if (!enabled) return null;

    const handleOpenChange = (next: boolean) => {
      setOpen(next);
      if (!next) setSearch('');
    };

    const handleSelect = (option: ProjectOption) => {
      handleOpenChange(false);
      const projectId = option.kind === 'project' ? option.project.id : null;
      if (projectId === (value ?? null)) return;
      if (onChange) {
        onChange(projectId);
        return;
      }
      // A failed save is rolled back and toasted by the store.
      if (taskIdentifier) void updateTask(taskIdentifier, { projectId }).catch(() => {});
    };

    const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      // Enter confirming an IME composition belongs to the search text, and
      // Cmd/Ctrl+Enter to the composer's submit.
      if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey) return;
      if (options.length === 0) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % options.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + options.length) % options.length);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const target = options[activeIndex];
        if (target) handleSelect(target);
      }
    };

    const renderOption = (option: ProjectOption, index: number) => (
      <div data-project-index={index} key={option.key} onMouseEnter={() => setActiveIndex(index)}>
        <NavItem
          active={index === activeIndex}
          style={{ flexShrink: 0 }}
          title={option.kind === 'project' ? option.project.name : noneLabel}
          extra={
            option.key === selectedKey ? (
              <Icon color={cssVar.colorTextSecondary} icon={CheckIcon} size={14} />
            ) : null
          }
          icon={
            option.kind === 'project' ? (
              <ProjectAvatar
                avatar={option.project.avatar}
                id={option.project.id}
                name={option.project.name}
                size={18}
              />
            ) : (
              <Icon color={cssVar.colorTextDescription} icon={FolderXIcon} size={16} />
            )
          }
          onClick={() => handleSelect(option)}
        />
      </div>
    );

    const hint = (text: string) => (
      <Flexbox align={'center'} justify={'center'} padding={16}>
        <Text fontSize={12} type={'secondary'}>
          {text}
        </Text>
      </Flexbox>
    );

    const renderBody = () => {
      if (listState === 'loading') return <SkeletonList rows={4} />;
      if (listState === 'error')
        return (
          <Flexbox align={'center'} gap={8} justify={'center'} padding={16}>
            <Text fontSize={12} type={'secondary'}>
              {t('taskProject.loadFailed')}
            </Text>
            <Button onClick={() => revalidate()}>{t('retry', { ns: 'common' })}</Button>
          </Flexbox>
        );
      return (
        <>
          {options.length > 0 && (
            <Flexbox
              gap={4}
              padding={8}
              ref={listRef}
              style={{ maxHeight: '50vh', overflowY: 'auto', width: '100%' }}
            >
              {options.map(renderOption)}
            </Flexbox>
          )}
          {matches.length === 0 && hint(t(query ? 'taskProject.noMatch' : 'taskProject.empty'))}
        </>
      );
    };

    const blockedReason = !canEdit ? reason : disabledReason;
    const blocked = !!blockedReason || !canEdit;
    const wrapperStyle = fullWidth ? { ...triggerStyle, width: '100%' } : triggerStyle;

    return (
      <Popover
        disabled={blocked}
        open={open}
        placement={'bottomLeft'}
        styles={{ content: { padding: 0, width: 260 } }}
        trigger={'click'}
        content={
          <Flexbox onClick={(event) => event.stopPropagation()}>
            <input
              autoFocus
              {...stylex.props(styles.searchInput)}
              aria-label={t('taskProject.searchPlaceholder')}
              placeholder={t('taskProject.searchPlaceholder')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
            {renderBody()}
          </Flexbox>
        }
        onOpenChange={handleOpenChange}
      >
        {blocked ? (
          <Tooltip title={blockedReason}>
            <div
              aria-disabled
              role={'button'}
              style={{ ...wrapperStyle, cursor: 'not-allowed', opacity: 0.5 }}
              onClick={(event) => event.stopPropagation()}
            >
              <span style={blockedContentStyle}>{children}</span>
            </div>
          </Tooltip>
        ) : (
          <div
            aria-expanded={open}
            aria-haspopup={'dialog'}
            role={'button'}
            style={wrapperStyle}
            tabIndex={0}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              handleOpenChange(true);
            }}
          >
            {children}
          </div>
        )}
      </Popover>
    );
  },
);

ProjectSelector.displayName = 'ProjectSelector';

export default ProjectSelector;
