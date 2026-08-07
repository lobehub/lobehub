import { useToolRenderCapabilities } from '@lobechat/shared-tool-ui';
import type { ReadFileState } from '@lobechat/tool-runtime';
import type { BuiltinRenderProps } from '@lobechat/types';
import path from 'path-browserify-esm';
import { memo, useMemo } from 'react';

import { parseOpenCodeReadContent } from './parseReadContent';
import ReadFileSkeleton from './ReadFileSkeleton';
import ReadFileView from './ReadFileView';

interface ReadFileArgs {
  file_path?: string;
  filePath?: string;
  limit?: number;
  offset?: number;
  path?: string;
}

const ReadFileQuery = memo<BuiltinRenderProps<ReadFileArgs, Partial<ReadFileState>, string>>(
  ({ args, content, identifier, messageId, pluginError, pluginState }) => {
    const { isLoading } = useToolRenderCapabilities();
    const loading = isLoading?.(messageId);
    const parsedContent = useMemo(
      () =>
        identifier === 'opencode'
          ? parseOpenCodeReadContent(content || '')
          : { content: content || '' },
      [content, identifier],
    );
    const filePath =
      args?.path ||
      args?.filePath ||
      args?.file_path ||
      pluginState?.path ||
      parsedContent.path ||
      '';
    const readState = useMemo<ReadFileState | undefined>(() => {
      if (pluginError) return;

      const canUseContentFallback = identifier === 'opencode' || identifier === 'pi';
      const text = pluginState?.content ?? (canUseContentFallback ? parsedContent.content : '');
      const images = pluginState?.images;
      if (!filePath || (!text && !images?.length)) return;

      const startLine = args?.offset ?? pluginState?.startLine ?? pluginState?.loc?.[0];
      const endLine =
        pluginState?.endLine ??
        pluginState?.loc?.[1] ??
        (startLine !== undefined && args?.limit !== undefined
          ? startLine + Math.max(args.limit - 1, 0)
          : undefined);

      return {
        ...pluginState,
        charCount: pluginState?.charCount ?? text.length,
        content: text,
        fileType: pluginState?.fileType ?? path.extname(filePath).slice(1).toLowerCase(),
        loc:
          pluginState?.loc ??
          (startLine !== undefined && endLine !== undefined ? [startLine, endLine] : undefined),
        path: filePath,
      };
    }, [
      args?.limit,
      args?.offset,
      filePath,
      identifier,
      parsedContent.content,
      pluginError,
      pluginState,
    ]);

    if (loading) {
      return <ReadFileSkeleton />;
    }

    if (!readState) return null;

    return <ReadFileView {...readState} />;
  },
);

export default ReadFileQuery;
