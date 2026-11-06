'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { oneLineEllipsis, shinyTextStyles } from '@/styles';

const styles = stylex.create({
  done: { color: cssVar.colorTextDescription },
});

export const GetPageContentInspector = memo<BuiltinInspectorProps>(({ isArgumentsStreaming }) => {
  const { t } = useTranslation('plugin');

  return (
    <div className={oneLineEllipsis}>
      <span
        className={
          isArgumentsStreaming ? shinyTextStyles.shinyText : stylex.props(styles.done).className
        }
      >
        {t('builtins.lobe-page-agent.apiName.getPageContent')}
      </span>
    </div>
  );
});

GetPageContentInspector.displayName = 'GetPageContentInspector';

export default GetPageContentInspector;
