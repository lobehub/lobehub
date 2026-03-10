'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { CheckCircle, DiffIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { oneLineEllipsis, shinyTextStyles } from '@/styles';

import type { UpdatePlanParams, UpdatePlanState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  title: css`
    margin-inline-end: 8px;
    color: ${cssVar.colorText};
  `,
}));

export const UpdatePlanInspector = memo<BuiltinInspectorProps<UpdatePlanParams, UpdatePlanState>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    const planId = args?.planId || partialArgs?.planId;
    const completed = args?.completed;
    const hasUpdates = args?.goal || args?.description || args?.context;

    if (isArgumentsStreaming && !planId) {
      return (
        <div className={cx(oneLineEllipsis, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-gtd.apiName.updatePlan')}</span>
        </div>
      );
    }

    return (
      <div className={cx(oneLineEllipsis, isArgumentsStreaming && shinyTextStyles.shinyText)}>
        <span className={styles.title}>{t('builtins.lobe-gtd.apiName.updatePlan')}</span>
        {completed && (
          <Text code as={'span'} color={cssVar.colorSuccess} fontSize={12}>
            <Icon icon={CheckCircle} size={12} />
            {t('builtins.lobe-gtd.apiName.updatePlan.completed')}
          </Text>
        )}
        {hasUpdates && !completed && (
          <Text code as={'span'} color={cssVar.colorWarning} fontSize={12}>
            <Icon icon={DiffIcon} size={12} />
            {t('builtins.lobe-gtd.apiName.updatePlan.modified')}
          </Text>
        )}
      </div>
    );
  },
);

UpdatePlanInspector.displayName = 'UpdatePlanInspector';

export default UpdatePlanInspector;
