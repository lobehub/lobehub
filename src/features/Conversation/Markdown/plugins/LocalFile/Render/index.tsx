import isEqual from 'fast-deep-equal';
import React, { memo } from 'react';

import { LocalFile } from '@/features/LocalFile';

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
  // "Start a topic in this folder" writes an agent default and opens a fresh
  // main-agent topic, so only offer it in a single-agent conversation — a group
  // chat's new topic would not inherit an individual agent's directory.
  const conversationAgentId = useConversationStore((s) =>
    s.context.groupId ? undefined : s.context.agentId,
  );

  if (!name || !path) {
    // If required properties are missing, render an error or null
    console.error('LocalFile Render component missing required properties:', node?.properties);
    return null; // Or return an error placeholder
  }

  // isDirectory may be true (from plugin) or undefined; ensure it is a boolean
  const isDir = isDirectory === true;

  return (
    <LocalFile
      conversationAgentId={conversationAgentId}
      isDirectory={isDir}
      name={name}
      path={path}
      readonly={isSharePage}
    />
  );
}, isEqual);

export default Render;
