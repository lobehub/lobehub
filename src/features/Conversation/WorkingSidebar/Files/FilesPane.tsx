import { Flexbox } from '@lobehub/ui';
import { Activity, memo } from 'react';

import FilesPrefetch from './FilesPrefetch';
import Files from './index';

interface FilesPaneProps {
  active: boolean;
  /** The tab is offered (agent mode) and a directory resolved. */
  available: boolean;
  className?: string;
  contentReady: boolean;
  deviceId?: string;
  directory?: string;
  /** Warm the tree even while the pane itself is hidden or still loading. */
  prefetch: boolean;
  /** The topic's temporary sandbox, read live from its session. */
  sandboxEphemeral?: boolean;
  sandboxInstanceId?: string;
  sandboxTopicId?: string;
}

/**
 * The Files tab, including its cold-start prefetch.
 *
 * The prefetch has to live outside the sidebar's `contentReady` gate: a
 * collapsed panel keeps the pane mounted but tears down its effects, so the
 * tree would otherwise be read only after the user opens the tab.
 */
const FilesPane = memo<FilesPaneProps>(
  ({
    active,
    available,
    className,
    contentReady,
    deviceId,
    directory,
    prefetch,
    sandboxEphemeral,
    sandboxInstanceId,
    sandboxTopicId,
  }) => {
    if (!available || directory === undefined) return null;

    return (
      <>
        {prefetch && (
          <FilesPrefetch
            deviceId={deviceId}
            sandboxEphemeral={sandboxEphemeral}
            sandboxInstanceId={sandboxInstanceId}
            sandboxTopicId={sandboxTopicId}
            workingDirectory={directory}
          />
        )}
        {contentReady && (
          <Activity mode={active ? 'visible' : 'hidden'}>
            <Flexbox className={className}>
              <Files
                deviceId={deviceId}
                sandboxEphemeral={sandboxEphemeral}
                sandboxInstanceId={sandboxInstanceId}
                sandboxTopicId={sandboxTopicId}
                workingDirectory={directory}
              />
            </Flexbox>
          </Activity>
        )}
      </>
    );
  },
);

FilesPane.displayName = 'AgentWorkingSidebarFilesPane';

export default FilesPane;
