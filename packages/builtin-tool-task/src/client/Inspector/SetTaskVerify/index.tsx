'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { SetTaskVerifyParams, SetTaskVerifyState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  identifierChip: css`
    flex-shrink: 0;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
}));

export const SetTaskVerifyInspector = memo<
  BuiltinInspectorProps<SetTaskVerifyParams, SetTaskVerifyState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const identifier = args?.identifier || partialArgs?.identifier;

  return (
    <div
      style={{ flexWrap: 'wrap', gap: 4 }}
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span>{t('builtins.lobe-task.apiName.setTaskVerify')}</span>
      {identifier && <span className={styles.identifierChip}>{identifier}</span>}
    </div>
  );
});

SetTaskVerifyInspector.displayName = 'SetTaskVerifyInspector';

export default SetTaskVerifyInspector;
