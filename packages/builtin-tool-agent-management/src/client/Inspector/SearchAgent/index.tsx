'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, shinyTextStyles } from '@/styles';

import type { SearchAgentParams, SearchAgentSource } from '../../../types';

const styles = stylex.create({
  root: { overflow: 'hidden', display: 'flex', gap: '8px', alignItems: 'center' },
  title: { flexShrink: 0, color: cssVar.colorTextSecondary, whiteSpace: 'nowrap' },
});

const getSourceTitleKey = (source: SearchAgentSource = 'all') => {
  switch (source) {
    case 'user': {
      return 'builtins.lobe-agent-management.inspector.searchAgent.user';
    }
    case 'market': {
      return 'builtins.lobe-agent-management.inspector.searchAgent.market';
    }
    default: {
      return 'builtins.lobe-agent-management.inspector.searchAgent.all';
    }
  }
};

export const SearchAgentInspector = memo<BuiltinInspectorProps<SearchAgentParams>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    const keyword = args?.keyword || partialArgs?.keyword;
    const source = args?.source || partialArgs?.source || 'all';

    const titleKey = useMemo(() => getSourceTitleKey(source), [source]);

    if (isArgumentsStreaming && !keyword) {
      return (
        <div {...stylex.props(styles.root)}>
          <span className={shinyTextStyles.shinyText}>
            {t('builtins.lobe-agent-management.apiName.searchAgent')}
          </span>
        </div>
      );
    }

    return (
      <Flexbox horizontal align={'center'} className={stylex.props(styles.root).className} gap={8}>
        <span
          className={cx(
            stylex.props(styles.title).className,
            isArgumentsStreaming && shinyTextStyles.shinyText,
          )}
        >
          {t(titleKey)}
        </span>
        {keyword && <span className={highlightTextStyles.primary}>{keyword}</span>}
      </Flexbox>
    );
  },
);

SearchAgentInspector.displayName = 'SearchAgentInspector';

export default SearchAgentInspector;
