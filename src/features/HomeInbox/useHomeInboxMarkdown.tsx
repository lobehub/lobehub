import type { MarkdownProps } from '@lobehub/ui';
import { useMemo } from 'react';

import LinkElement from '@/features/Conversation/Markdown/plugins/Link';

const rehypePlugins = LinkElement.rehypePlugin ? [LinkElement.rehypePlugin] : [];

/**
 * Home is not hosted by a ConversationProvider, so inbox previews deliberately
 * support only the provider-free link plugin. Conversation-only markup remains
 * readable as plain Markdown instead of mounting components that require chat
 * context.
 */
export const useHomeInboxMarkdown = (messageId: string): Partial<MarkdownProps> => {
  const components = useMemo(
    () => ({
      [LinkElement.tag]: (props: Record<PropertyKey, unknown>) => (
        <LinkElement.Component {...props} id={messageId} />
      ),
    }),
    [messageId],
  );

  return useMemo(
    () => ({
      components,
      rehypePlugins,
    }),
    [components],
  );
};
