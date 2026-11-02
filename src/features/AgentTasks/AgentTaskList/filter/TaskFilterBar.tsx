'use client';

import {
  TASK_LIST_FILTER_DATE_WINDOWS,
  type TaskListFilter,
  type TaskListFilterDateField,
  type TaskListFilterSet,
} from '@lobechat/types';
import {
  Button,
  cssVar as cssVarJs,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Icon,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { TextSearchIcon, XIcon } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  isTaskFilterValueSelected,
  removeTaskFilterField,
  setTaskFilterContent,
  setTaskFilterDateWindow,
  showsTaskFilterValuesInline,
  taskFilterSetOperatorKey,
  type TaskFilterValue,
  toggleTaskFilterOperator,
  toggleTaskFilterValue,
} from './taskFilterState';
import type { TaskFilterFieldDef, TaskFilterSetFieldDef } from './useTaskFilterFields';

const styles = stylex.create({
  bar: {
    flexWrap: 'wrap',
    paddingBlockEnd: 8,
    paddingBlockStart: 4,
    paddingInline: 16,
  },
  chip: {
    alignItems: 'stretch',
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 6,
    borderStyle: 'solid',
    borderWidth: 1,
    color: cssVar.colorText,
    display: 'inline-flex',
    fontSize: 12,
    height: 26,
    lineHeight: '24px',
    overflow: 'hidden',
  },
  contentInput: {
    backgroundColor: 'transparent',
    borderStyle: 'none',
    color: cssVar.colorText,
    fontSize: 12,
    outline: 'none',
    paddingBlock: 0,
    paddingInline: 8,
    width: 140,
  },
  secondary: {
    color: cssVar.colorTextSecondary,
  },
  segment: {
    alignItems: 'center',
    borderInlineEndColor: cssVar.colorBorderSecondary,
    borderInlineEndStyle: 'solid',
    borderInlineEndWidth: { 'default': 1, ':last-child': 0 },
    display: 'inline-flex',
    gap: 6,
    paddingInline: 8,
    whiteSpace: 'nowrap',
  },
  segmentButton: {
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    cursor: 'pointer',
    transitionDuration: cssVar.motionDurationMid,
    transitionProperty: 'background-color',
  },
});

/** Content typed into the chip is committed after this pause, like a search box. */
const CONTENT_COMMIT_DELAY_MS = 400;

interface TaskFilterBarProps {
  fields: TaskFilterFieldDef[];
  filter?: TaskListFilter;
  setFilter: (updater: (prev: TaskListFilter | undefined) => TaskListFilter | undefined) => void;
}

const Segment = ({
  children,
  onClick,
  secondary,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  secondary?: boolean;
  title?: string;
}) => (
  <span
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
    title={title}
    {...stylex.props(
      styles.segment,
      !!onClick && styles.segmentButton,
      secondary && styles.secondary,
    )}
    onClick={onClick}
    onKeyDown={
      onClick
        ? (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onClick();
            }
          }
        : undefined
    }
  >
    {children}
  </span>
);

const ContentInput = memo<{ onCommit: (value: string) => void; value: string }>(
  ({ onCommit, value }) => {
    const [draft, setDraft] = useState(value);

    useEffect(() => setDraft(value), [value]);
    useEffect(() => {
      if (draft.trim() === value) return;
      const timer = setTimeout(() => onCommit(draft), CONTENT_COMMIT_DELAY_MS);
      return () => clearTimeout(timer);
    }, [draft, onCommit, value]);

    return (
      <input
        {...stylex.props(styles.contentInput)}
        value={draft}
        onBlur={() => draft.trim() !== value && onCommit(draft)}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter') onCommit(draft);
        }}
      />
    );
  },
);

ContentInput.displayName = 'TaskFilterContentInput';

/**
 * The active filter as Linear-style chips under the header:
 * `[field] [operator] [values] [×]`. The operator flips on click, the values
 * reopen the value menu, × drops the condition; "Clear" drops them all.
 */
const TaskFilterBar = memo<TaskFilterBarProps>(({ fields, filter, setFilter }) => {
  const { t } = useTranslation('chat');

  if (!filter) return null;

  const removeButton = (field: Parameters<typeof removeTaskFilterField>[1]) => (
    <Segment
      title={t('taskList.filter.remove')}
      onClick={() => setFilter((prev) => removeTaskFilterField(prev, field))}
    >
      <Icon icon={XIcon} size={12} />
    </Segment>
  );

  const renderSetChip = (field: TaskFilterSetFieldDef) => {
    const set = filter[field.key] as TaskListFilterSet<TaskFilterValue> | undefined;
    if (!set) return null;
    const selected = set.values.map(
      (value) =>
        field.options.find((option) => option.value === value) ?? {
          // A value whose option is gone (a deleted agent, a member who left)
          // still renders, so it can be seen and removed.
          icon: undefined,
          label: t('taskList.filter.unknownValue'),
          value,
        },
    );
    const summary = showsTaskFilterValuesInline(selected.length)
      ? selected.map((option) => option.label).join(', ')
      : t('taskList.filter.valueCount', { count: selected.length });
    const valueItems: DropdownItem[] = field.options.map((option) => ({
      checked: isTaskFilterValueSelected(filter, field.key, option.value),
      closeOnClick: false,
      icon: option.icon,
      key: `${field.key}:${option.value}`,
      label: option.label,
      onCheckedChange: () =>
        setFilter((prev) => toggleTaskFilterValue(prev, field.key, option.value)),
      type: 'checkbox' as const,
    }));

    return (
      <span
        {...stylex.props(styles.chip)}
        data-testid={`task-filter-chip-${field.key}`}
        key={field.key}
      >
        <Segment>
          <Icon color={cssVarJs.colorTextSecondary} icon={field.icon} size={14} />
          {field.label}
        </Segment>
        <Segment
          secondary
          onClick={() => setFilter((prev) => toggleTaskFilterOperator(prev, field.key))}
        >
          {t(taskFilterSetOperatorKey(set.operator, set.values.length))}
        </Segment>
        <DropdownMenu items={valueItems}>
          <span
            {...stylex.props(styles.segment, styles.segmentButton)}
            role={'button'}
            tabIndex={0}
          >
            {showsTaskFilterValuesInline(selected.length) &&
              selected.map((option) => (
                <span key={String(option.value)} style={{ display: 'inline-flex' }}>
                  {option.icon}
                </span>
              ))}
            {summary}
          </span>
        </DropdownMenu>
        {removeButton(field.key)}
      </span>
    );
  };

  const renderDateChip = (field: {
    icon: TaskFilterFieldDef['icon'];
    key: TaskListFilterDateField;
    label: string;
  }) => {
    const date = filter[field.key];
    if (!date) return null;
    const windowItems: DropdownItem[] = TASK_LIST_FILTER_DATE_WINDOWS.map((window) => ({
      checked: date.window === window,
      key: `${field.key}:${window}`,
      label: t(`taskList.filter.window.${window}`),
      onCheckedChange: () => setFilter((prev) => setTaskFilterDateWindow(prev, field.key, window)),
      type: 'checkbox' as const,
    }));

    return (
      <span
        {...stylex.props(styles.chip)}
        data-testid={`task-filter-chip-${field.key}`}
        key={field.key}
      >
        <Segment>
          <Icon color={cssVarJs.colorTextSecondary} icon={field.icon} size={14} />
          {field.label}
        </Segment>
        <Segment
          secondary
          onClick={() => setFilter((prev) => toggleTaskFilterOperator(prev, field.key))}
        >
          {t(
            date.operator === 'before'
              ? 'taskList.filter.operator.before'
              : 'taskList.filter.operator.within',
          )}
        </Segment>
        <DropdownMenu items={windowItems}>
          <span
            {...stylex.props(styles.segment, styles.segmentButton)}
            role={'button'}
            tabIndex={0}
          >
            {t(`taskList.filter.window.${date.window}`)}
          </span>
        </DropdownMenu>
        {removeButton(field.key)}
      </span>
    );
  };

  return (
    <Flexbox horizontal align={'center'} {...stylex.props(styles.bar)} gap={6}>
      {fields.map((field) => (field.kind === 'set' ? renderSetChip(field) : renderDateChip(field)))}
      {filter.content && (
        <span {...stylex.props(styles.chip)} data-testid={'task-filter-chip-content'}>
          <Segment>
            <Icon color={cssVarJs.colorTextSecondary} icon={TextSearchIcon} size={14} />
            {t('taskList.filter.field.content')}
          </Segment>
          <Segment secondary>{t('taskList.filter.operator.contains')}</Segment>
          <ContentInput
            value={filter.content}
            onCommit={(value) => setFilter((prev) => setTaskFilterContent(prev, value))}
          />
          {removeButton('content')}
        </span>
      )}
      <Button size={'small'} type={'text'} onClick={() => setFilter(() => undefined)}>
        {t('taskList.filter.clear')}
      </Button>
    </Flexbox>
  );
});

TaskFilterBar.displayName = 'TaskFilterBar';

export default TaskFilterBar;
