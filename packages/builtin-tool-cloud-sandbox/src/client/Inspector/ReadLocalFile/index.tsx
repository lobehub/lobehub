'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ReadLocalFileState } from '../../../types';
import { FilePathDisplay } from '../../components/FilePathDisplay';

const styles = createStaticStyles(({ css }) => ({
  lineRange: css`
    flex-shrink: 0;
    margin-inline-start: 4px;
    opacity: 0.7;
  `,
}));

interface ReadLocalFileParams {
  end_line?: number;
  path: string;
  start_line?: number;
}

export const ReadLocalFileInspector = memo<
  BuiltinInspectorProps<ReadLocalFileParams, ReadLocalFileState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const filePath = args?.path || partialArgs?.path || '';
  const startLine = args?.start_line || partialArgs?.start_line;
  const endLine = args?.end_line || partialArgs?.end_line;

  // Format line range display, e.g., "L1-L200"
  const lineRangeText = useMemo(() => {
    if (startLine === undefined && endLine === undefined) return null;
    const start = startLine ?? 1;
    const end = endLine;
    if (end !== undefined) {
      return `L${start}-L${end}`;
    }
    return `L${start}`;
  }, [startLine, endLine]);

  // During argument streaming
  if (isArgumentsStreaming) {
    if (!filePath)
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-cloud-sandbox.apiName.readLocalFile')}</span>
        </div>
      );

    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-cloud-sandbox.apiName.readLocalFile')}: </span>
        <FilePathDisplay filePath={filePath} />
        {lineRangeText && <span className={styles.lineRange}>{lineRangeText}</span>}
      </div>
    );
  }

  return (
    <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
      <span>{t('builtins.lobe-cloud-sandbox.apiName.readLocalFile')}: </span>
      <FilePathDisplay filePath={filePath} />
      {lineRangeText && <span className={styles.lineRange}>{lineRangeText}</span>}
    </div>
  );
});

ReadLocalFileInspector.displayName = 'ReadLocalFileInspector';
