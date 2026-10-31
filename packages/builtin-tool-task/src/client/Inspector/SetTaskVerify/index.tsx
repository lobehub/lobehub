'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { SetTaskVerifyParams, SetTaskVerifyState } from '../../../types';

const styles = stylex.create({
  identifierChip: {
    flexShrink: 0,
    paddingBlock: '2px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    background: cssVar.colorFillTertiary,
  },
});

export const SetTaskVerifyInspector = memo<
  BuiltinInspectorProps<SetTaskVerifyParams, SetTaskVerifyState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const identifier = pluginState?.identifier ?? args?.identifier ?? partialArgs?.identifier;

  return (
    <div className={inspectorTextStyles.root} style={{ flexWrap: 'wrap', gap: 4 }}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-task.apiName.setTaskVerify')}
      </span>
      {identifier && <span {...stylex.props(styles.identifierChip)}>{identifier}</span>}
    </div>
  );
});

SetTaskVerifyInspector.displayName = 'SetTaskVerifyInspector';

export default SetTaskVerifyInspector;
