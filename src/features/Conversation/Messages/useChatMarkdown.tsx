'use client';

import { type MarkdownProps } from '@lobehub/ui';
import { type ReactNode, useEffect, useMemo, useState } from 'react';

import { HtmlPreviewDrawer } from '@/components/HtmlPreview';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { type MarkdownElement, markdownElements } from '../Markdown/plugins';

// Honor each plugin's declared `scope`: this hook renders assistant / grouped
// messages, so user-only constructs (skill, tool, action, mention, …) must not
// be parsed here — otherwise a `<skill … />` the model happens to echo back
// would render as an interactive chip. Mirrors the `scope !== 'assistant'`
// filter on the user-message hook.
const assistantMarkdownElements = markdownElements.filter((s) => s.scope !== 'user');

const rehypePlugins = assistantMarkdownElements
  .map((element: MarkdownElement) => element.rehypePlugin)
  .filter(Boolean);
const remarkPlugins = assistantMarkdownElements
  .map((element: MarkdownElement) => element.remarkPlugin)
  .filter(Boolean);

/**
 * Message ids whose text has already been on screen. The stream renderer fades
 * every character in from zero on mount, so a remount — the group re-partitions,
 * or a stream patch and a snapshot refresh disagree about the block's shape —
 * must not replay that fade over text the user has already read.
 */
const shownTextIds = new Set<string>();

interface UseChatMarkdownOptions {
  citations?: MarkdownProps['citations'];
  enableStream?: boolean;
  /** Whether the message has text to show yet; loading placeholders do not count. */
  hasContent?: boolean;
  id: string;
  isGenerating: boolean;
}

export const useChatMarkdown = ({
  id,
  isGenerating,
  citations,
  enableStream: enableStreamOption = true,
  hasContent = false,
}: UseChatMarkdownOptions): {
  drawer: ReactNode;
  markdownProps: Partial<MarkdownProps>;
} => {
  const { transitionMode } = useUserStore(userGeneralSettingsSelectors.config);
  // Once text has settled (rendered statically, or shown by an earlier mount),
  // it never re-enters streaming: switching back remounts the stream renderer.
  const [settled, setSettled] = useState(() => shownTextIds.has(id));
  if (!settled && hasContent && !enableStreamOption) setSettled(true);
  useEffect(() => {
    if (hasContent) shownTextIds.add(id);
  }, [hasContent, id]);

  const enableStream = enableStreamOption && !settled;
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
        // @deprecated Inline HTML preview and streaming are superseded by Canvas; kept for existing messages.
        enableHtmlPreview: true,
        enableStream,
        rehypePlugins,
        remarkPlugins,
        showFootnotes: !citations?.length || citations.every((item) => item.title !== item.url),
      }) satisfies Partial<MarkdownProps>,
    [animated, citations, components, enableStream],
  );

  const drawer = useMemo(
    () =>
      drawerContent ? (
        <HtmlPreviewDrawer
          content={drawerContent}
          open={!!drawerContent}
          onClose={() => setDrawerContent(null)}
        />
      ) : null,
    [drawerContent],
  );

  return useMemo(() => ({ drawer, markdownProps }), [drawer, markdownProps]);
};
