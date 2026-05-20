'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ShowAgentMarketplaceArgs } from '../../../types';
import { CATEGORY_LABEL_I18N_KEYS } from '../../Intervention/PickAgents/constants';
import { inspectorChipStyles } from '../_styles';

const HIDDEN_CHIP_THRESHOLD = 3;

export const ShowAgentMarketplaceInspector = memo<
  BuiltinInspectorProps<ShowAgentMarketplaceArgs, Record<string, unknown>>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t: tPlugin } = useTranslation('plugin');
  const { t: tTool } = useTranslation('tool');
  const styles = inspectorChipStyles;

  const categoryHints = args?.categoryHints ?? partialArgs?.categoryHints ?? [];

  if (isArgumentsStreaming && categoryHints.length === 0) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{tPlugin('builtins.lobe-web-onboarding.apiName.showAgentMarketplace')}</span>
      </div>
    );
  }

  const visibleHints = categoryHints.slice(0, HIDDEN_CHIP_THRESHOLD);
  const overflowCount = categoryHints.length - visibleHints.length;

  return (
    <div
      style={{ flexWrap: 'wrap', gap: 4 }}
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span>{tPlugin('builtins.lobe-web-onboarding.apiName.showAgentMarketplace')}</span>
      {visibleHints.map((slug) => {
        const labelKey = CATEGORY_LABEL_I18N_KEYS[slug];
        return (
          <span className={styles.chip} key={slug}>
            {labelKey ? tTool(labelKey) : slug}
          </span>
        );
      })}
      {overflowCount > 0 && (
        <span className={styles.meta}>
          {tTool('agentMarketplace.inspector.moreCategories', { count: overflowCount })}
        </span>
      )}
    </div>
  );
});

ShowAgentMarketplaceInspector.displayName = 'ShowAgentMarketplaceInspector';

export default ShowAgentMarketplaceInspector;
