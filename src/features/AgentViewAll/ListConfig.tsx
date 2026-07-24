'use client';

import { type FormItemProps } from '@lobehub/ui';
import { ActionIcon, Flexbox, Form, Icon, Popover } from '@lobehub/ui';
import { Select, Switch, Tabs } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  LayoutGrid,
  LayoutList,
  Settings2Icon,
} from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';

import type { AgentGroupBy, AgentListViewOptions, AgentOrderBy } from './listViewOptions';

type ViewMode = 'card' | 'list';

interface ListConfigProps {
  options: AgentListViewOptions;
  setOptions: (updater: (prev: AgentListViewOptions) => AgentListViewOptions) => void;
  setViewMode: (mode: ViewMode) => void;
  /** Author-based grouping/ordering only makes sense inside a workspace. */
  showAuthor?: boolean;
  viewMode: ViewMode;
}

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    form: css`
      label {
        font-size: 13px !important;
        color: ${cssVar.colorTextSecondary} !important;
      }
    `,
  };
});

const ListConfig = memo<ListConfigProps>(
  ({ options, setOptions, setViewMode, showAuthor, viewMode }) => {
    const [open, setOpen] = useState(false);
    const { t } = useTranslation('common');

    const groupingOptions = useMemo<Array<{ label: string; value: AgentGroupBy }>>(
      () => [
        { label: t('agentViewAll.groupBy.none'), value: 'none' },
        { label: t('agentViewAll.groupBy.author'), value: 'author' },
      ],
      [t],
    );
    const orderOptions = useMemo<Array<{ label: string; value: AgentOrderBy }>>(
      () => [
        { label: t('agentViewAll.orderBy.updatedAt'), value: 'updatedAt' },
        ...(showAuthor
          ? [{ label: t('agentViewAll.orderBy.author'), value: 'author' as const }]
          : []),
        { label: t('agentViewAll.orderBy.title'), value: 'title' },
      ],
      [showAuthor, t],
    );

    const formItems: FormItemProps[] = [
      ...(showAuthor
        ? [
            {
              children: (
                <Select
                  options={groupingOptions}
                  size={'small'}
                  style={{ width: 150 }}
                  value={options.groupBy}
                  onChange={(value: AgentGroupBy) => {
                    setOptions((prev) => ({ ...prev, groupBy: value }));
                  }}
                />
              ),
              label: t('agentViewAll.form.grouping'),
            } satisfies FormItemProps,
          ]
        : []),
      {
        children: (
          <Flexbox horizontal align={'center'} gap={8}>
            <ActionIcon
              icon={options.orderDirection === 'asc' ? ArrowUpNarrowWide : ArrowDownWideNarrow}
              size={'small'}
              onClick={() => {
                setOptions((prev) => ({
                  ...prev,
                  orderDirection: prev.orderDirection === 'asc' ? 'desc' : 'asc',
                }));
              }}
            />
            <Select
              options={orderOptions}
              size={'small'}
              style={{ width: 112 }}
              value={options.orderBy}
              onChange={(value: AgentOrderBy) => {
                setOptions((prev) => ({ ...prev, orderBy: value }));
              }}
            />
          </Flexbox>
        ),
        label: t('agentViewAll.form.ordering'),
      },
      {
        children: (
          <Switch
            checked={options.showSidebarHidden}
            size={'small'}
            onChange={(checked) => {
              setOptions((prev) => ({ ...prev, showSidebarHidden: checked }));
            }}
          />
        ),
        minWidth: undefined,
        label: t('agentViewAll.form.showSidebarHidden'),
      },
    ];

    const panelContent = (
      <Flexbox gap={12} width={280}>
        <Tabs
          activeKey={viewMode}
          items={[
            { icon: <Icon icon={LayoutList} />, key: 'list', label: t('agentViewAll.view.list') },
            { icon: <Icon icon={LayoutGrid} />, key: 'card', label: t('agentViewAll.view.card') },
          ]}
          styles={{
            list: { display: 'flex', width: '100%' },
            tab: { flex: 1 },
          }}
          onChange={(key) => setViewMode(key as ViewMode)}
        />
        <Form
          className={styles.form}
          items={formItems}
          itemsType={'flat'}
          size={'small'}
          variant={'borderless'}
          styles={{
            item: { padding: 0 },
          }}
        />
      </Flexbox>
    );

    return (
      <Popover
        arrow={false}
        content={panelContent}
        open={open}
        placement={'bottomRight'}
        trigger={['click']}
        onOpenChange={setOpen}
      >
        <ActionIcon icon={Settings2Icon} size={DESKTOP_HEADER_ICON_SMALL_SIZE} />
      </Popover>
    );
  },
);

ListConfig.displayName = 'AgentViewAllListConfig';

export default ListConfig;
