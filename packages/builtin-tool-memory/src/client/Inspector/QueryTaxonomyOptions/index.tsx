'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { QueryTaxonomyOptionsParams, QueryTaxonomyOptionsState } from '../../../types';

const getTotalOptions = (state?: QueryTaxonomyOptionsState) => {
  if (!state) return 0;

  return (
    state.categories.length +
    state.labels.length +
    state.relationships.length +
    state.roles.length +
    state.statuses.length +
    state.tags.length +
    state.types.length
  );
};

export const QueryTaxonomyOptionsInspector = memo<
  BuiltinInspectorProps<QueryTaxonomyOptionsParams, QueryTaxonomyOptionsState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const query = args?.q || partialArgs?.q || '';
  const resultCount = getTotalOptions(pluginState);
  const hasResults = resultCount > 0;

  if (isArgumentsStreaming && !query) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-user-memory.apiName.queryTaxonomyOptions')}</span>
      </div>
    );
  }

  return (
    <div
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span>{t('builtins.lobe-user-memory.apiName.queryTaxonomyOptions')}: </span>
      {query && <span className={highlightTextStyles.primary}>{query}</span>}
      {!isLoading &&
        !isArgumentsStreaming &&
        pluginState &&
        (hasResults ? (
          <span style={{ marginInlineStart: 4 }}>({resultCount})</span>
        ) : (
          <Text
            as={'span'}
            color={cssVar.colorTextDescription}
            fontSize={12}
            style={{ marginInlineStart: 4 }}
          >
            ({t('builtins.lobe-user-memory.inspector.noResults')})
          </Text>
        ))}
    </div>
  );
});

QueryTaxonomyOptionsInspector.displayName = 'QueryTaxonomyOptionsInspector';

export default QueryTaxonomyOptionsInspector;
