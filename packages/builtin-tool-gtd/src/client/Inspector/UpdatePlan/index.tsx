'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { CheckCircle, DiffIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

import type { UpdatePlanParams, UpdatePlanState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  completed: css`
    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorSuccess};
  `,
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
  `,
  title: css`
    margin-inline-end: 8px;
    color: ${cssVar.colorText};
  `,
  updated: css`
    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorWarning};
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
        <div className={cx(styles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-gtd.apiName.updatePlan')}</span>
        </div>
      );
    }

    return (
      <div className={cx(styles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}>
        <span className={styles.title}>{t('builtins.lobe-gtd.apiName.updatePlan')}</span>
        {completed && (
          <span className={styles.completed}>
            <Icon icon={CheckCircle} size={12} />
            {t('builtins.lobe-gtd.apiName.updatePlan.completed')}
          </span>
        )}
        {hasUpdates && !completed && (
          <span className={styles.updated}>
            <Icon icon={DiffIcon} size={12} />
            {t('builtins.lobe-gtd.apiName.updatePlan.modified')}
          </span>
        )}
      </div>
    );
  },
);

UpdatePlanInspector.displayName = 'UpdatePlanInspector';

export default UpdatePlanInspector;
