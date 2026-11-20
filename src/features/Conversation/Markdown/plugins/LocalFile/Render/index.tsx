import isEqual from 'fast-deep-equal';
import React, { memo } from 'react';

import { LocalFile } from '@/features/LocalFile';

import { useStartTopicConversation } from '../../../../hooks/useStartTopicConversation';
import { useOpenEditedFile } from '../../../../Messages/EditedFilesCard/useOpenEditedFile';
import { useConversationStore } from '../../../../store';
import { type MarkdownElementProps } from '../../type';

interface LocalFileProps {
  isDirectory: boolean;
  name: string;
  path: string;
}

const Render = memo<MarkdownElementProps<LocalFileProps>>(({ node }) => {
  // Extract properties from node.properties
  const { name, path, isDirectory } = node?.properties || {};
  // Both share surfaces are read-only for the viewer. On the agent-share
  // visitor page this also matters on Electron: an interactive chip would let
  // a model/creator-controlled `<local_file path>` open a path on the
  // VISITOR's machine via `shell.openPath`.
  const isSharePage = useConversationStore(
    (s) => !!s.context.topicShareId || !!s.context.agentShareId,
  );
  const conversation = useStartTopicConversation();
  // Same reachability rules as the edited-files card: on web the file opens in
  // the portal only when the agent's bound device can serve the read.
  const resolveOpenFile = useOpenEditedFile();

  if (!name || !path) {
    // If required properties are missing, render an error or null
    console.error('LocalFile Render component missing required properties:', node?.properties);
    return null; // Or return an error placeholder
  }

  // isDirectory may be true (from plugin) or undefined; ensure it is a boolean
  const isDir = isDirectory === true;
  const openInPortal = isDir
    ? undefined
    : resolveOpenFile({ kind: 'modified', path, sandboxBacked: false });

  return (
    <LocalFile
      conversation={conversation}
      isDirectory={isDir}
      name={name}
      openInPortal={openInPortal}
      path={path}
      readonly={isSharePage}
    />
  );
}, isEqual);

export default Render;
