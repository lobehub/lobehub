import { type MarkdownProps } from '@lobehub/ui';
import { useMemo } from 'react';

import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { type MarkdownElement } from '../../Markdown/plugins';
import { markdownElements } from '../../Markdown/plugins';
import { dataSelectors, messageStateSelectors, useConversationStore } from '../../store';

export const useMarkdown = (id: string): Partial<MarkdownProps> => {
  const item = useConversationStore(dataSelectors.getDbMessageById(id));
  const { transitionMode } = useUserStore(userGeneralSettingsSelectors.config);
  const generating = useConversationStore(messageStateSelectors.isMessageGenerating(id));

  const animated = transitionMode === 'fadeIn' && generating;

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
    () => markdownElements.map((element) => element.rehypePlugin).filter(Boolean),
    [],
  );
  const remarkPlugins = useMemo(
    () => markdownElements.map((element) => element.remarkPlugin).filter(Boolean),
    [],
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
