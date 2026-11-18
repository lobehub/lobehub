'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ListGroupMembersParams, ListGroupMembersState } from '../../../types';

export const ListGroupMembersInspector = memo<
  BuiltinInspectorProps<ListGroupMembersParams, ListGroupMembersState>
>(({ isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const total = pluginState?.total ?? pluginState?.members?.length;

  return (
    <div className={inspectorTextStyles.root}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-group-agent-builder.apiName.listGroupMembers')}
      </span>
      {!isLoading && !isArgumentsStreaming && total !== undefined && (
        <span style={{ marginInlineStart: 4 }}>({total})</span>
      )}
    </div>
  );
});

ListGroupMembersInspector.displayName = 'ListGroupMembersInspector';

export default ListGroupMembersInspector;
