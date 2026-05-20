'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ListTasksParams, ListTasksState } from '../../../types';

export const ListTasksInspector = memo<BuiltinInspectorProps<ListTasksParams, ListTasksState>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
    const { t } = useTranslation('plugin');

    const filters = args || partialArgs || {};
    const total = pluginState?.total;
    const count = pluginState?.count;

    const filterParts: string[] = [];
    if (filters.parentIdentifier) filterParts.push(filters.parentIdentifier);
    if (filters.statuses?.length) filterParts.push(filters.statuses.join(','));
    if (filters.priorities?.length) filterParts.push(`p=${filters.priorities.join(',')}`);
    const filterText = filterParts.join(' · ');

    if (isArgumentsStreaming && !filterText) {
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-task.apiName.listTasks')}</span>
        </div>
      );
    }

    return (
      <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-task.apiName.listTasks')}</span>
        {filterText && (
          <Text as={'span'} color={cssVar.colorTextTertiary} fontSize={12}>
            {' · '}
            {filterText}
          </Text>
        )}
        {typeof count === 'number' && (
          <Text code as={'span'} color={cssVar.colorTextSecondary} fontSize={12}>
            {typeof total === 'number' && total !== count ? `${count}/${total}` : count}
          </Text>
        )}
      </div>
    );
  },
);

ListTasksInspector.displayName = 'ListTasksInspector';

export default ListTasksInspector;
