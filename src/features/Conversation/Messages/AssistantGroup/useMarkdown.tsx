import { type MarkdownProps } from '@lobehub/ui';
import { useMemo } from 'react';

import { THINKING_TAG } from '@/const/plugin';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { type MarkdownElement } from '../../Markdown/plugins';
import { markdownElements } from '../../Markdown/plugins';
import { dataSelectors, messageStateSelectors, useConversationStore } from '../../store';
import { shouldProcessThinkTags } from '../../utils/markdown';

export const useMarkdown = (id: string): Partial<MarkdownProps> => {
  const item = useConversationStore(dataSelectors.getDbMessageById(id));
  const { transitionMode } = useUserStore(userGeneralSettingsSelectors.config);
  const generating = useConversationStore(messageStateSelectors.isMessageGenerating(id));

  const animated = transitionMode === 'fadeIn' && generating;
  const shouldEnableThinkTag = shouldProcessThinkTags(item?.content, generating);

  const activeMarkdownElements = useMemo(
    () =>
      markdownElements.filter((element) => element.tag !== THINKING_TAG || shouldEnableThinkTag),
    [shouldEnableThinkTag],
  );

  const components = useMemo(
    () =>
      Object.fromEntries(
        markdownElements.map((element: MarkdownElement) => {
          const Component = element.Component;

          return [element.tag, (props: any) => <Component {...props} id={id} />];
        }),
      ),
    [id],
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
