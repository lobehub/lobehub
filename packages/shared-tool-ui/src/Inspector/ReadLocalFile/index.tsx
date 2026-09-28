'use client';

import type { ReadFileState } from '@lobechat/tool-runtime';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FilePathDisplay, getFilePathDisplayInfo } from '../../components/FilePathDisplay';
import { inspectorTextStyles, shinyTextStyles } from '../../styles';
import { formatReadLineRange } from './formatLineRange';

interface ReadFileArgs {
  endLine?: number;
  file_path?: string;
  filePath?: string;
  limit?: number;
  loc?: [number, number];
  offset?: number;
  path?: string;
  startLine?: number;
}

export const createReadLocalFileInspector = (
  translationKey: string,
  imageTranslationKey?: string,
) => {
  const Inspector = memo<BuiltinInspectorProps<ReadFileArgs, ReadFileState>>(
    ({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
      const { t } = useTranslation('plugin');

      const filePath =
        args?.path ||
        args?.filePath ||
        args?.file_path ||
        partialArgs?.path ||
        partialArgs?.filePath ||
        partialArgs?.file_path ||
        pluginState?.path ||
        '';
      // File hints let streaming captures display as images; uploaded image state
      // also identifies extensionless files. No screenshot provenance is inferred.
      const isImage = getFilePathDisplayInfo(filePath).isImage || !!pluginState?.images?.length;
      const label =
        imageTranslationKey && isImage
          ? `${imageTranslationKey}${isArgumentsStreaming || isLoading ? '.loading' : ''}`
          : translationKey;

      const lineRange = useMemo(
        () => formatReadLineRange(args || partialArgs),
        [args, partialArgs],
      );

      if (isArgumentsStreaming) {
        if (!filePath)
          return (
            <div className={inspectorTextStyles.root}>
              <span className={shinyTextStyles.shinyText}>{t(label as any)}</span>
            </div>
          );

        return (
          <div className={inspectorTextStyles.root}>
            <span className={shinyTextStyles.shinyText} style={{ marginInlineEnd: 6 }}>
              {t(label as any)}:
            </span>
            <FilePathDisplay filePath={filePath} />
          </div>
        );
      }

      return (
        <div className={inspectorTextStyles.root}>
          <span
            className={cx(isLoading && shinyTextStyles.shinyText)}
            style={{ marginInlineEnd: 6 }}
          >
            {t(label as any)}:
          </span>
          <FilePathDisplay filePath={filePath} />
          {lineRange && <span style={{ marginInlineStart: 4 }}>({lineRange})</span>}
        </div>
      );
    },
  );
  Inspector.displayName = 'ReadLocalFileInspector';
  return Inspector;
};
