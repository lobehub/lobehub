import { useToolRenderCapabilities } from '@lobechat/shared-tool-ui';
import type { ReadFileState } from '@lobechat/tool-runtime';
import type { BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';

import ReadFileSkeleton from './ReadFileSkeleton';
import ReadFileView from './ReadFileView';

const ReadFileQuery = memo<BuiltinRenderProps<{ path: string }, ReadFileState>>(
  ({ args, pluginState, messageId }) => {
    const { isLoading } = useToolRenderCapabilities();
    const loading = isLoading?.(messageId);

    if (loading) {
      return <ReadFileSkeleton />;
    }

    if (!args?.path || !pluginState) return null;

    return <ReadFileView {...pluginState} path={args.path} />;
  },
);

export default ReadFileQuery;
