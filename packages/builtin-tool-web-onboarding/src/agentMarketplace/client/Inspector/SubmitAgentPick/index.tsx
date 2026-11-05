'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { SubmitAgentPickArgs } from '../../../types';
import { inspectorChipStyles } from '../_styles';

export const SubmitAgentPickInspector = memo<
  BuiltinInspectorProps<SubmitAgentPickArgs, Record<string, unknown>>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t: tPlugin } = useTranslation('plugin');
  const { t: tTool } = useTranslation('tool');

  const ids = args?.selectedTemplateIds ?? partialArgs?.selectedTemplateIds ?? [];

  if (isArgumentsStreaming && ids.length === 0) {
    return (
      <div className={inspectorTextStyles.root}>
        <span className={shinyTextStyles.shinyText}>
          {tPlugin('builtins.lobe-web-onboarding.apiName.submitAgentPick')}
        </span>
      </div>
    );
  }

  return (
    <div className={inspectorTextStyles.root} style={{ gap: 4 }}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {tPlugin('builtins.lobe-web-onboarding.apiName.submitAgentPick')}
      </span>
      {ids.length > 0 && (
        <span {...stylex.props(inspectorChipStyles.meta)}>
          {tTool('agentMarketplace.inspector.pickCount', { count: ids.length })}
        </span>
      )}
    </div>
  );
});

SubmitAgentPickInspector.displayName = 'SubmitAgentPickInspector';

export default SubmitAgentPickInspector;
