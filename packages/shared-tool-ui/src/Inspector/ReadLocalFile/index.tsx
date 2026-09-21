'use client';

import type { ReadFileState } from '@lobechat/tool-runtime';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FilePathDisplay, getFilePathDisplayInfo } from '../../components/FilePathDisplay';
import { inspectorTextStyles, shinyTextStyles } from '../../styles';

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

      const lineRange = useMemo(() => {
        const source = args || partialArgs;
        const start = source?.startLine ?? source?.loc?.[0] ?? source?.offset;
        const end =
          source?.endLine ??
          source?.loc?.[1] ??
          (start !== undefined && source?.limit !== undefined
            ? start + Math.max(source.limit - 1, 0)
            : undefined);
        if (start !== undefined && end !== undefined) return `L${start}-L${end}`;
        if (start !== undefined) return `L${start}`;
        return undefined;
      }, [args, partialArgs]);

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
