'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { oneLineEllipsis, shinyTextStyles } from '@/styles';

const styles = createStaticStyles(({ css, cssVar }) => ({
  done: css`
    color: ${cssVar.colorTextDescription};
  `,
}));

export const GetPageContentInspector = memo<BuiltinInspectorProps>(({ isArgumentsStreaming }) => {
  const { t } = useTranslation('plugin');

  return (
    <div className={oneLineEllipsis}>
      <span className={cx(isArgumentsStreaming ? shinyTextStyles.shinyText : styles.done)}>
        {t('builtins.lobe-page-agent.apiName.getPageContent')}
      </span>
    </div>
  );
});

GetPageContentInspector.displayName = 'GetPageContentInspector';

export default GetPageContentInspector;
