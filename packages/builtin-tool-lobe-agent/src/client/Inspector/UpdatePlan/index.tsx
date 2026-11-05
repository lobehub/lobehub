'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckCircle, DiffIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { oneLineEllipsis, shinyTextStyles } from '@/styles';

import type { UpdatePlanParams, UpdatePlanState } from '../../../types';

const styles = stylex.create({
  title: { marginInlineEnd: '8px' },
  titleColor: { color: cssVar.colorText },
});

export const UpdatePlanInspector = memo<BuiltinInspectorProps<UpdatePlanParams, UpdatePlanState>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    const planId = args?.planId || partialArgs?.planId;
    const completed = args?.completed;
    const hasUpdates = args?.goal || args?.description || args?.context;

    if (isArgumentsStreaming && !planId) {
      return (
        <div className={oneLineEllipsis}>
          <span className={shinyTextStyles.shinyText}>
            {t('builtins.lobe-agent.apiName.updatePlan')}
          </span>
        </div>
      );
    }

    return (
      <div className={oneLineEllipsis}>
        <span
          className={cx(
            stylex.props(styles.title, !isArgumentsStreaming && styles.titleColor).className,
            isArgumentsStreaming && shinyTextStyles.shinyText,
          )}
        >
          {t('builtins.lobe-agent.apiName.updatePlan')}
        </span>
        {completed && (
          <Text code as={'span'} color={cssVar.colorSuccess} fontSize={12}>
            <Icon icon={CheckCircle} size={12} />
            {t('builtins.lobe-agent.apiName.updatePlan.completed')}
          </Text>
        )}
        {hasUpdates && !completed && (
          <Text code as={'span'} color={cssVar.colorWarning} fontSize={12}>
            <Icon icon={DiffIcon} size={12} />
            {t('builtins.lobe-agent.apiName.updatePlan.modified')}
          </Text>
        )}
      </div>
    );
  },
);

UpdatePlanInspector.displayName = 'UpdatePlanInspector';

export default UpdatePlanInspector;
