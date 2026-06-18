'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ListChecks } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { GenerateVerifyPlanParams, GenerateVerifyPlanState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    overflow: hidden;
    display: inline-flex;
    flex: none;
    gap: 4px;
    align-items: center;

    max-width: 260px;
    margin-inline-start: 6px;
    padding-block: 1px;
    padding-inline: 6px 8px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;

    color: ${cssVar.colorText};
  `,
  chipIcon: css`
    flex: none;
    color: ${cssVar.colorTextSecondary};
  `,
  chipLabel: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

export const GenerateVerifyPlanInspector = memo<
  BuiltinInspectorProps<GenerateVerifyPlanParams, GenerateVerifyPlanState>
>(({ args, partialArgs, pluginState, isArgumentsStreaming }) => {
  const { t } = useTranslation('plugin');

  const title = pluginState?.title || args?.title || partialArgs?.title;

  return (
    <div
      className={cx(inspectorTextStyles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}
    >
      <span>{t('builtins.lobe-delivery-checker.apiName.generateVerifyPlan')}</span>
      {title && (
        <span className={styles.chip}>
          <Icon className={styles.chipIcon} icon={ListChecks} size={13} />
          <span className={styles.chipLabel}>{title}</span>
        </span>
      )}
    </div>
  );
});

GenerateVerifyPlanInspector.displayName = 'GenerateVerifyPlanInspector';

export default GenerateVerifyPlanInspector;
