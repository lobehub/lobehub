import { DEFAULT_TASK_LABEL_COLOR, type TaskLabel, type TaskLabelRef } from '@lobechat/types';
import { cssVar, Flexbox, Icon, Popover, Text, Tooltip } from '@lobehub/ui';
import { cssVar as sxVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckIcon, PlusIcon } from 'lucide-react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useFetchTaskLabels } from '@/hooks/useFetchTaskLabels';
import { usePermission } from '@/hooks/usePermission';
import { useTaskStore } from '@/store/task';
import { taskLabelSelectors } from '@/store/task/selectors';
import { saveToast } from '@/store/utils/saveToast';

import {
  buildTaskLabelPickerSections,
  canCreateTaskLabel,
  toggleTaskLabelSelection,
  toTaskLabelRef,
} from './labelPickerModel';
import TaskLabelDot from './TaskLabelDot';

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
  sectionHeader: {
    paddingBlock: 4,
    paddingInline: 8,
    fontSize: 12,
    lineHeight: 1.4,
    color: sxVar.colorTextTertiary,
  },
});

const triggerStyle: CSSProperties = {
  alignItems: 'center',
  display: 'inline-flex',
  maxWidth: '100%',
  minWidth: 0,
};

type PickerOption =
  { key: string; kind: 'create' } | { key: string; kind: 'label'; label: TaskLabel };

interface TaskLabelPickerProps {
  children: ReactNode;
  disabled?: boolean;
  /** Called with the full next selection after every toggle. */
  onChange: (next: TaskLabelRef[]) => void;
  value: TaskLabelRef[];
}

/**
 * Multi-select label picker: search, toggle, and create a label inline from
 * the search text. Labels of a group are listed under it and are mutually
 * exclusive — picking one swaps out its sibling, as the server enforces.
 */
const TaskLabelPicker = memo<TaskLabelPickerProps>(({ children, disabled, onChange, value }) => {
  const { t } = useTranslation('chat');
  const { allowed: canEdit, reason } = usePermission('create_content');
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const { isLoading } = useFetchTaskLabels();
  const registry = useTaskStore(taskLabelSelectors.labels);
  const createTaskLabel = useTaskStore((s) => s.createTaskLabel);

  const sections = useMemo(
    () => buildTaskLabelPickerSections(registry, search),
    [registry, search],
  );
  const showCreate = canCreateTaskLabel(registry, search);
  const flatOptions = useMemo<PickerOption[]>(
    () => [
      ...sections.flatMap((section) =>
        section.labels.map((label) => ({ key: label.id, kind: 'label' as const, label })),
      ),
      ...(showCreate ? [{ key: '__create__', kind: 'create' as const }] : []),
    ],
    [sections, showCreate],
  );
  const indexByKey = useMemo(
    () => new Map(flatOptions.map((option, index) => [option.key, index])),
    [flatOptions],
  );
  const selectedIds = useMemo(() => new Set(value.map((label) => label.id)), [value]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-label-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const handleCreate = useCallback(async () => {
    const name = search.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const label = await createTaskLabel({ color: DEFAULT_TASK_LABEL_COLOR, name });
      setSearch('');
      onChange([...value, toTaskLabelRef(label)]);
    } catch (error) {
      saveToast(error, { title: t('taskLabel.createFailed') });
    } finally {
      setCreating(false);
    }
  }, [createTaskLabel, creating, onChange, search, t, value]);

  const handleSelect = useCallback(
    (option: PickerOption) => {
      if (option.kind === 'create') {
        void handleCreate();
        return;
      }
      onChange(toggleTaskLabelSelection(value, option.label));
    },
    [handleCreate, onChange, value],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (flatOptions.length === 0) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % flatOptions.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + flatOptions.length) % flatOptions.length);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const target = flatOptions[activeIndex];
        if (target) handleSelect(target);
      }
    },
    [activeIndex, flatOptions, handleSelect],
  );

  const renderLabel = (label: TaskLabel) => {
    const index = indexByKey.get(label.id) ?? 0;
    const selected = selectedIds.has(label.id);
    return (
      <div data-label-index={index} key={label.id} onMouseEnter={() => setActiveIndex(index)}>
        <NavItem
          active={index === activeIndex}
          icon={<TaskLabelDot color={label.color} />}
          style={{ flexShrink: 0 }}
          title={label.name}
          extra={
            selected ? <Icon color={cssVar.colorTextSecondary} icon={CheckIcon} size={14} /> : null
          }
          onClick={() => handleSelect({ key: label.id, kind: 'label', label })}
        />
      </div>
    );
  };

  const createIndex = indexByKey.get('__create__');
  const blocked = disabled || !canEdit;

  const content = (
    <Flexbox onClick={(event) => event.stopPropagation()}>
      <input
        autoFocus
        {...stylex.props(styles.searchInput)}
        placeholder={t('taskLabel.searchPlaceholder')}
        value={search}
        onKeyDown={handleKeyDown}
        onChange={(event) => {
          setSearch(event.target.value);
          setActiveIndex(0);
        }}
      />
      {isLoading ? (
        <SkeletonList rows={4} />
      ) : flatOptions.length === 0 ? (
        <Flexbox align={'center'} justify={'center'} padding={16}>
          <Text fontSize={12} type={'secondary'}>
            {t('taskLabel.empty')}
          </Text>
        </Flexbox>
      ) : (
        <Flexbox
          gap={4}
          padding={8}
          ref={listRef}
          style={{ maxHeight: '50vh', overflowY: 'auto', width: '100%' }}
        >
          {sections.map((section) => (
            <Flexbox gap={4} key={section.group?.id ?? '__loose__'}>
              {section.group && (
                <div {...stylex.props(styles.sectionHeader)}>{section.group.name}</div>
              )}
              {section.labels.map(renderLabel)}
            </Flexbox>
          ))}
          {createIndex !== undefined && (
            <div data-label-index={createIndex} onMouseEnter={() => setActiveIndex(createIndex)}>
              <NavItem
                active={createIndex === activeIndex}
                disabled={creating}
                icon={PlusIcon}
                style={{ flexShrink: 0 }}
                title={t('taskLabel.createNamed', { name: search.trim() })}
                onClick={() => void handleCreate()}
              />
            </div>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );

  const trigger = blocked ? (
    <Tooltip title={disabled ? undefined : reason}>
      <div
        style={{ ...triggerStyle, cursor: 'not-allowed', opacity: 0.5 }}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </Tooltip>
  ) : (
    <div style={triggerStyle} onClick={(event) => event.stopPropagation()}>
      {children}
    </div>
  );

  return (
    <Popover
      content={content}
      disabled={blocked}
      placement={'bottomLeft'}
      styles={{ content: { padding: 0, width: 260 } }}
      trigger={'click'}
      onOpenChange={(open) => {
        if (!open) setSearch('');
      }}
    >
      {trigger}
    </Popover>
  );
});

TaskLabelPicker.displayName = 'TaskLabelPicker';

export default TaskLabelPicker;
