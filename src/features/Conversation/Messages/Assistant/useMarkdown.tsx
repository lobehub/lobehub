'use client';

import { type MarkdownProps } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import { HtmlPreviewAction } from '@/components/HtmlPreview';
import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { markdownElements } from '../../Markdown/plugins';
import { dataSelectors, messageStateSelectors, useConversationStore } from '../../store';
import { getActiveAssistantMarkdownElements } from '../../utils/markdown';

const isHtmlCode = (content: string, language: string) => {
  return (
    language === 'html' ||
    (language === '' && content.includes('<html>')) ||
    (language === '' && content.includes('<!DOCTYPE html>'))
  );
};

export const useMarkdown = (id: string): Partial<MarkdownProps> => {
  const item = useConversationStore(dataSelectors.getDbMessageById(id), isEqual)!;
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
        activeMarkdownElements.map((element) => {
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
        citations: search?.citations,
        componentProps: {
          highlight: {
            actionsRender: ({ content, actionIconSize, language, originalNode }: any) => {
              const showHtmlPreview = isHtmlCode(content, language);
              return (
                <>
                  {showHtmlPreview && <HtmlPreviewAction content={content} size={actionIconSize} />}
                  {originalNode}
                </>
              );
            },
          },
        },
        components,
        enableCustomFootnotes: true,
        enableStream: true,
        rehypePlugins,
        remarkPlugins,
        showFootnotes:
          search?.citations &&
          // if the citations are all empty, we should not show the citations
          search?.citations.length > 0 &&
          // if the citations's url and title are all the same, we should not show the citations
          search?.citations.every((item) => item.title !== item.url),
      }) satisfies Partial<MarkdownProps>,
    [animated, components, rehypePlugins, remarkPlugins, search],
  );
};
