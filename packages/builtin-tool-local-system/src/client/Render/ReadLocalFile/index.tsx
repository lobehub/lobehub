import { useToolRenderCapabilities } from '@lobechat/shared-tool-ui';
import type { ReadFileState } from '@lobechat/tool-runtime';
import type { BuiltinRenderProps } from '@lobechat/types';
import { memo, useMemo } from 'react';

import type { ReadFileArgs } from './buildReadFileState';
import { buildReadFileState, getFirstLineNumber } from './buildReadFileState';
import { parseOpenCodeReadContent } from './parseReadContent';
import ReadFileSkeleton from './ReadFileSkeleton';
import ReadFileView from './ReadFileView';

// Cloud-sandbox reuses this render; its files live in the sandbox, not on disk.
const CLOUD_SANDBOX_IDENTIFIER = 'lobe-cloud-sandbox';

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
    const readState = useMemo<ReadFileState | undefined>(
      () => buildReadFileState({ args, identifier, parsedContent, pluginError, pluginState }),
      [args, identifier, parsedContent, pluginError, pluginState],
    );

    const firstLineNumber = useMemo(
      () => getFirstLineNumber({ args, pluginState }),
      [args, pluginState],
    );

    if (loading) {
      return <ReadFileSkeleton />;
    }

    if (!readState) return null;

    return (
      <ReadFileView
        {...readState}
        firstLineNumber={firstLineNumber}
        sandboxBacked={identifier === CLOUD_SANDBOX_IDENTIFIER}
      />
    );
  },
);

export default ReadFileQuery;
