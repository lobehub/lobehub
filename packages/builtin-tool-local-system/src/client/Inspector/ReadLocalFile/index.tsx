'use client';

import type { LocalReadFileParams } from '@lobechat/electron-client-ipc';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { LocalReadFileState } from '../../..';
import { FilePathDisplay } from '../../components/FilePathDisplay';

const styles = createStaticStyles(({ css }) => ({
  lineRange: css`
    flex-shrink: 0;
    margin-inline-start: 4px;
    font-size: 12px;
    opacity: 0.7;
  `,
}));

export const ReadLocalFileInspector = memo<
  BuiltinInspectorProps<LocalReadFileParams, LocalReadFileState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const filePath = args?.path || partialArgs?.path || '';
  const loc = args?.loc || partialArgs?.loc;

  // Format line range display, e.g., "L1-L200"
  const lineRangeText = useMemo(() => {
    if (!loc || loc.length !== 2) return null;
    const [start, end] = loc;
    return `L${start + 1}-L${end}`;
  }, [loc]);

  // During argument streaming
  if (isArgumentsStreaming) {
    if (!filePath)
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-local-system.apiName.readLocalFile')}</span>
        </div>
      );

    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-local-system.apiName.readLocalFile')}: </span>
        <FilePathDisplay filePath={filePath} />
        {lineRangeText && <span className={styles.lineRange}>{lineRangeText}</span>}
      </div>
    );
  }

  return (
    <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
      <span>{t('builtins.lobe-local-system.apiName.readLocalFile')}: </span>
      <FilePathDisplay filePath={filePath} />
      {lineRangeText && <span className={styles.lineRange}>{lineRangeText}</span>}
    </div>
  );
});

ReadLocalFileInspector.displayName = 'ReadLocalFileInspector';
