import { type MarkdownProps } from '@lobehub/ui';
import { useMemo } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { type MarkdownElement } from '../../Markdown/plugins';
import { markdownElements } from '../../Markdown/plugins';
import { dataSelectors, messageStateSelectors, useConversationStore } from '../../store';
import { getActiveAssistantMarkdownElements } from '../../utils/markdown';

export const useMarkdown = (id: string): Partial<MarkdownProps> => {
  const item = useConversationStore(dataSelectors.getDbMessageById(id));
  const { content, search, tools } = item || {};
  const { transitionMode } = useUserStore(userGeneralSettingsSelectors.config);
  const isLocalSystemEnabled = useAgentStore(agentChatConfigSelectors.isLocalSystemEnabled);
  const generating = useConversationStore(messageStateSelectors.isMessageGenerating(id));

  const animated = transitionMode === 'fadeIn' && generating;
  const activeMarkdownElements = useMemo(
    () =>
      getActiveAssistantMarkdownElements(markdownElements, {
        content,
        hasImageSearchResults: !!search?.imageResults?.length,
        isGenerating: generating,
        isLocalSystemEnabled,
        tools,
      }),
    [content, generating, isLocalSystemEnabled, search?.imageResults?.length, tools],
  );

  const components = useMemo(
    () =>
      Object.fromEntries(
        activeMarkdownElements.map((element: MarkdownElement) => {
          const Component = element.Component;

          return [element.tag, (props: any) => <Component {...props} id={id} />];
        }),
      ),
    [activeMarkdownElements, id],
  );

  const rehypePlugins = useMemo(
    () => activeMarkdownElements.map((element) => element.rehypePlugin).filter(Boolean),
    [activeMarkdownElements],
  );
  const remarkPlugins = useMemo(
    () => activeMarkdownElements.map((element) => element.remarkPlugin).filter(Boolean),
    [activeMarkdownElements],
  );

  return useMemo(
    () =>
      ({
        animated,
        components,
        enableCustomFootnotes: true,
        enableStream: true,
        rehypePlugins,
        remarkPlugins,
      }) satisfies Partial<MarkdownProps>,
    [animated, components, rehypePlugins, remarkPlugins],
  );
};
