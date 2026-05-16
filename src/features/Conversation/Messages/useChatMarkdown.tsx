'use client';

import { type MarkdownProps } from '@lobehub/ui';
import { type ReactNode, useMemo, useState } from 'react';

import { HtmlPreviewDrawer } from '@/components/HtmlPreview';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { type MarkdownElement, markdownElements } from '../Markdown/plugins';

const rehypePlugins = markdownElements
  .map((element: MarkdownElement) => element.rehypePlugin)
  .filter(Boolean);
const remarkPlugins = markdownElements
  .map((element: MarkdownElement) => element.remarkPlugin)
  .filter(Boolean);

interface UseChatMarkdownOptions {
  citations?: MarkdownProps['citations'];
  enableStream?: boolean;
  id: string;
  isGenerating: boolean;
}

export const useChatMarkdown = ({
  id,
  isGenerating,
  citations,
  enableStream = true,
}: UseChatMarkdownOptions): {
  drawer: ReactNode;
  markdownProps: Partial<MarkdownProps>;
} => {
  const { transitionMode } = useUserStore(userGeneralSettingsSelectors.config);
  const animated = enableStream && transitionMode === 'fadeIn' && isGenerating;

  const [drawerContent, setDrawerContent] = useState<string | null>(null);

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

  const markdownProps = useMemo(
    () =>
      ({
        animated,
        citations,
        componentProps: {
          html: {
            onExpand: (content: string) => setDrawerContent(content),
          },
        },
        components,
        enableCustomFootnotes: true,
        enableHtmlPreview: true,
        enableStream,
        rehypePlugins,
        remarkPlugins,
        showFootnotes:
          !!citations && citations.length > 0 && citations.every((item) => item.title !== item.url),
      }) satisfies Partial<MarkdownProps>,
    [animated, citations, components, enableStream],
  );

  const drawer = drawerContent ? (
    <HtmlPreviewDrawer
      content={drawerContent}
      open={!!drawerContent}
      onClose={() => setDrawerContent(null)}
    />
  ) : null;

  return useMemo(() => ({ drawer, markdownProps }), [drawer, markdownProps]);
};
