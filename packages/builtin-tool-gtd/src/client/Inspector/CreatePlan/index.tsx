'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

import type { CreatePlanParams, CreatePlanState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  goal: css`
    padding-block-end: 1px;
    color: ${cssVar.colorText};
    background: linear-gradient(to top, ${cssVar.colorPrimaryBg} 40%, transparent 40%);
  `,
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    color: ${cssVar.colorTextSecondary};
  `,
}));

export const CreatePlanInspector = memo<BuiltinInspectorProps<CreatePlanParams, CreatePlanState>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    const goal = args?.goal || partialArgs?.goal;

    if (isArgumentsStreaming && !goal) {
      return (
        <div className={cx(styles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-gtd.apiName.createPlan')}</span>
        </div>
      );
    }

    return (
      <div className={cx(styles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}>
        {goal ? (
          <Trans
            components={{ goal: <span className={styles.goal} /> }}
            i18nKey="builtins.lobe-gtd.apiName.createPlan.result"
            ns="plugin"
            values={{ goal }}
          />
        ) : (
          <span>{t('builtins.lobe-gtd.apiName.createPlan')}</span>
        )}
      </div>
    );
  },
);

CreatePlanInspector.displayName = 'CreatePlanInspector';

export default CreatePlanInspector;
