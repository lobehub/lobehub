'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const ProposedPlanInspector = memo<BuiltinInspectorProps>(({ isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');
  return (
    <div
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      {t('builtins.codex.apiName.proposed_plan', { defaultValue: 'Plan' })}
    </div>
  );
});

ProposedPlanInspector.displayName = 'CodexProposedPlanInspector';

export default ProposedPlanInspector;
