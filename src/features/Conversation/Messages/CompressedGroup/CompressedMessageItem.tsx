'use client';

import type { UIChatMessage } from '@lobechat/types';
import { Flexbox, Icon, Markdown, Tag } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Bot, Wrench } from 'lucide-react';
import { memo } from 'react';

import { ChatItem } from '@/features/Conversation/ChatItem';
import { useUserAvatar } from '@/hooks/useUserAvatar';

import FileListViewer from '../User/components/FileListViewer';
import ImageFileListViewer from '../User/components/ImageFileListViewer';
import VideoFileListViewer from '../User/components/VideoFileListViewer';

const styles = createStaticStyles(({ css }) => ({
  messageItem: css`
    .message-wrapper {
      padding-block: 4px;
    }
  `,
  toolTag: css`
    font-size: 12px;
  `,
}));

interface CompressedMessageItemProps {
  message: UIChatMessage;
}

/**
 * Renders a single message within a compressed group
 * Uses ChatItem for consistent layout with main conversation
 */
const CompressedMessageItem = memo<CompressedMessageItemProps>(({ message }) => {
  const userAvatar = useUserAvatar();
  const { role, content, children, imageList, videoList, fileList } = message;

  // Render user message
  if (role === 'user') {
    return (
      <ChatItem
        avatar={{ avatar: userAvatar }}
        className={styles.messageItem}
        message={content}
        placement="right"
        showAvatar={false}
        showTitle={false}
      >
        <Flexbox gap={8}>
          {content && <Markdown variant="chat">{content}</Markdown>}
          {imageList && imageList.length > 0 && <ImageFileListViewer items={imageList} />}
          {videoList && videoList.length > 0 && <VideoFileListViewer items={videoList} />}
          {fileList && fileList.length > 0 && <FileListViewer items={fileList} />}
        </Flexbox>
      </ChatItem>
    );
  }

  // Render assistant message (standalone without tools)
  if (role === 'assistant') {
    return (
      <ChatItem
        avatar={{ avatar: <Icon icon={Bot} />, backgroundColor: '#1677ff' }}
        className={styles.messageItem}
        message={content}
        placement="left"
        showAvatar={false}
        showTitle={false}
      >
        <Markdown variant="chat">{content}</Markdown>
      </ChatItem>
    );
  }

  // Render assistantGroup (assistant message with tool calls)
  if (role === 'assistantGroup') {
    // Get tool names from children
    const toolNames = children
      ?.filter((child) => child.tools && child.tools.length > 0)
      .flatMap((child) => child.tools?.map((tool) => tool.apiName) || []);

    const uniqueToolNames = [...new Set(toolNames)];

    // Get the last content block (assistant's final response)
    const lastContentBlock = children?.find((child) => !child.tools || child.tools.length === 0);
    const displayContent = lastContentBlock?.content || content;

    return (
      <ChatItem
        avatar={{ avatar: <Icon icon={Bot} />, backgroundColor: '#1677ff' }}
        className={styles.messageItem}
        message={displayContent}
        placement="left"
        showAvatar={false}
        showTitle={false}
      >
        <Flexbox gap={8}>
          {uniqueToolNames.length > 0 && (
            <Flexbox gap={4} horizontal wrap="wrap">
              {uniqueToolNames.map((name) => (
                <Tag className={styles.toolTag} icon={<Icon icon={Wrench} size={12} />} key={name}>
                  {name}
                </Tag>
              ))}
            </Flexbox>
          )}
          {displayContent && <Markdown variant="chat">{displayContent}</Markdown>}
        </Flexbox>
      </ChatItem>
    );
  }

  // Skip other roles (tool, system, etc.)
  return null;
});

CompressedMessageItem.displayName = 'CompressedMessageItem';

export default CompressedMessageItem;
