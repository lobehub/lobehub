import type { MarkdownProps } from '@lobehub/ui';
import type { FC } from 'react';
import { useMemo } from 'react';

import LinkElement from '@/features/Conversation/Markdown/plugins/Link';
import type { MarkdownElementProps } from '@/features/Conversation/Markdown/plugins/type';

const rehypePlugins = LinkElement.rehypePlugin ? [LinkElement.rehypePlugin] : [];

/**
 * Home is not hosted by a ConversationProvider, so inbox previews deliberately
 * support only the provider-free link plugin. Conversation-only markup remains
 * readable as plain Markdown instead of mounting components that require chat
 * context.
 */
export const useHomeInboxMarkdown = (messageId: string): Partial<MarkdownProps> => {
  const components = useMemo(() => {
    const LinkComponent: FC = (props) => (
      <LinkElement.Component {...(props as MarkdownElementProps)} id={messageId} />
    );

    return { [LinkElement.tag]: LinkComponent };
  }, [messageId]);

  return useMemo(
    () => ({
      components,
      rehypePlugins,
    }),
    [components],
  );
};
