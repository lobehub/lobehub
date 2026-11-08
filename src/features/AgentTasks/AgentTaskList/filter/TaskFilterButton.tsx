'use client';

import { HotkeyEnum } from '@lobechat/const/hotkeys';
import { TASK_LIST_FILTER_DATE_WINDOWS, type TaskListFilter } from '@lobechat/types';
import {
  ActionIcon,
  cssVar as cssVarJs,
  type DropdownItem,
  DropdownMenu,
  Hotkey,
  Icon,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CalendarIcon, ListFilterIcon, TextSearchIcon } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { useHotkeyById } from '@/hooks/useHotkeys/useHotkeyById';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import {
  isTaskFilterValueSelected,
  setTaskFilterContent,
  setTaskFilterDateWindow,
  toggleTaskFilterValue,
} from './taskFilterState';
import type { TaskFilterDateFieldDef, TaskFilterFieldDef } from './useTaskFilterFields';

const styles = stylex.create({
  search: {
    alignItems: 'center',
    display: 'flex',
    gap: 8,
    paddingBlock: 6,
    paddingInline: 12,
  },
  searchInput: {
    'backgroundColor': 'transparent',
    'borderStyle': 'none',
    'color': cssVar.colorText,
    'flex': '1',
    'fontSize': 14,
    'minWidth': 0,
    'outline': 'none',
    'padding': 0,
    '::placeholder': {
      color: cssVar.colorTextQuaternary,
    },
  },
});

interface TaskFilterButtonProps {
  fields: TaskFilterFieldDef[];
  filter?: TaskListFilter;
  setFilter: (updater: (prev: TaskListFilter | undefined) => TaskListFilter | undefined) => void;
}

const matches = (text: string, query: string) => text.toLowerCase().includes(query);

/**
 * The header's "Add filter" entry, after Linear: a searchable menu of fields,
 * each opening its values as checkboxes. Typing searches values across every
 * field at once and offers a content search for the typed text.
 */
const TaskFilterButton = memo<TaskFilterButtonProps>(({ fields, filter, setFilter }) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setSearch('');
  }, []);

  const hotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.OpenTaskFilter));
  // A bare key: typing in a field must not open the menu. Live only while the Tasks page is mounted.
  useHotkeyById(HotkeyEnum.OpenTaskFilter, () => handleOpenChange(true), {
    enableOnContentEditable: false,
    enableOnFormTags: false,
    enabled: true,
  });

  const query = search.trim().toLowerCase();

  const items = useMemo<DropdownItem[]>(() => {
    const dateWindowItems = (field: TaskFilterDateFieldDef): DropdownItem[] =>
      TASK_LIST_FILTER_DATE_WINDOWS.map((window) => ({
        checked: filter?.[field.key]?.window === window,
        closeOnClick: false,
        key: `${field.key}:${window}`,
        label: t(`taskList.filter.window.${window}`),
        onCheckedChange: () =>
          setFilter((prev) => setTaskFilterDateWindow(prev, field.key, window)),
        type: 'checkbox' as const,
      }));

    const fieldItem = (field: TaskFilterFieldDef): DropdownItem => ({
      children:
        field.kind === 'date'
          ? dateWindowItems(field)
          : field.options.map((option) => ({
              checked: isTaskFilterValueSelected(filter, field.key, option.value),
              closeOnClick: false,
              icon: option.icon,
              key: `${field.key}:${option.value}`,
              label: option.label,
              onCheckedChange: () =>
                setFilter((prev) => toggleTaskFilterValue(prev, field.key, option.value)),
              type: 'checkbox' as const,
            })),
      icon: <Icon color={cssVarJs.colorTextSecondary} icon={field.icon} size={16} />,
      key: field.key,
      label: field.label,
      type: 'submenu' as const,
    });

    const setFields = fields.filter((field) => field.kind === 'set');
    const dateFields = fields.filter(
      (field): field is TaskFilterDateFieldDef => field.kind === 'date',
    );

    if (!query) {
      return [
        ...setFields.map(fieldItem),
        { key: 'divider-dates', type: 'divider' as const },
        {
          children: dateFields.map(fieldItem),
          icon: <Icon color={cssVarJs.colorTextSecondary} icon={CalendarIcon} size={16} />,
          key: 'dates',
          label: t('taskList.filter.field.dates'),
          type: 'submenu' as const,
        },
      ];
    }

    const contentItem: DropdownItem = {
      icon: <Icon color={cssVarJs.colorTextSecondary} icon={TextSearchIcon} size={16} />,
      key: 'content',
      label: t('taskList.filter.contentContains', { text: search.trim() }),
      onClick: () => {
        setFilter((prev) => setTaskFilterContent(prev, search));
        handleOpenChange(false);
      },
    };
    const matchedFields = fields.filter((field) => matches(field.label, query)).map(fieldItem);
    const matchedValues: DropdownItem[] = setFields.flatMap((field) =>
      field.kind === 'set'
        ? field.options
            .filter((option) => matches(option.label, query))
            .map((option) => ({
              checked: isTaskFilterValueSelected(filter, field.key, option.value),
              closeOnClick: false,
              icon: option.icon,
              key: `match:${field.key}:${option.value}`,
              label: `${field.label}: ${option.label}`,
              onCheckedChange: () =>
                setFilter((prev) => toggleTaskFilterValue(prev, field.key, option.value)),
              type: 'checkbox' as const,
            }))
        : [],
    );

    return [
      contentItem,
      ...(matchedFields.length > 0 || matchedValues.length > 0
        ? [{ key: 'divider-matches', type: 'divider' as const }]
        : []),
      ...matchedFields,
      ...matchedValues,
    ];
  }, [fields, filter, handleOpenChange, query, search, setFilter, t]);

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Keep typing in the box: the menu would treat letters as typeahead.
    if (event.key !== 'Escape' && event.key !== 'ArrowDown') event.stopPropagation();
  };

  return (
    <DropdownMenu
      items={items}
      open={open}
      placement={'bottomRight'}
      popupProps={{ style: { minWidth: 260 } }}
      header={
        <div {...stylex.props(styles.search)}>
          <input
            autoFocus
            {...stylex.props(styles.searchInput)}
            placeholder={t('taskList.filter.searchPlaceholder')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          <Hotkey keys={hotkey} />
        </div>
      }
      onOpenChange={handleOpenChange}
    >
      <ActionIcon
        active={open}
        icon={ListFilterIcon}
        size={DESKTOP_HEADER_ICON_SMALL_SIZE}
        title={t('taskList.filter.add')}
        tooltipProps={{ hotkey }}
      />
    </DropdownMenu>
  );
});

TaskFilterButton.displayName = 'TaskFilterButton';

export default TaskFilterButton;
