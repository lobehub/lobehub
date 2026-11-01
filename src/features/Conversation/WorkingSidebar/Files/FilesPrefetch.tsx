import { memo } from 'react';

import { useFilesTreeSources } from './useFilesTreeSources';

interface FilesPrefetchProps {
  deviceId?: string;
  sandboxInstanceId?: string;
  sandboxTopicId?: string;
  workingDirectory: string;
}

/**
 * Warms the Files tree while its pane is hidden. A hidden `<Activity>` keeps
 * the pane mounted but tears down its effects, and SWR only fetches from an
 * effect — so a collapsed panel whose remembered tab is Files would otherwise
 * start reading the tree only once the user opened it.
 */
const FilesPrefetch = memo<FilesPrefetchProps>(
  ({ deviceId, sandboxInstanceId, sandboxTopicId, workingDirectory }) => {
    useFilesTreeSources(deviceId, workingDirectory, {
      instanceId: sandboxInstanceId,
      // Warm the tree once. A hidden prefetch must not inherit the visible
      // pane's sandbox polling or focus revalidation and keep walking the
      // workspace.
      live: false,
      topicId: sandboxTopicId,
    });
    return null;
  },
);

FilesPrefetch.displayName = 'AgentWorkingSidebarFilesPrefetch';

export default FilesPrefetch;
