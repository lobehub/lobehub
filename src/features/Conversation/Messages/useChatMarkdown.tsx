'use client';

import { LOADING_FLAT } from '@lobechat/const';
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
 * Length of the text each message id has already shown. The stream renderer
 * fades every character in from zero on mount, so a remount — the group
 * re-partitions, or a stream patch and a snapshot refresh disagree about the
 * block's shape — must not replay that fade over text the user has already
 * read. Text that keeps growing after the remount still streams.
 */
const shownTextLengths = new Map<string, number>();

interface UseChatMarkdownOptions {
  citations?: MarkdownProps['citations'];
  /** The message text; a loading placeholder counts as no text. */
  content?: string;
  enableStream?: boolean;
  id: string;
  isGenerating: boolean;
}

export const useChatMarkdown = ({
  id,
  isGenerating,
  citations,
  enableStream: enableStreamOption = true,
  content,
}: UseChatMarkdownOptions): {
  drawer: ReactNode;
  markdownProps: Partial<MarkdownProps>;
} => {
  const { transitionMode } = useUserStore(userGeneralSettingsSelectors.config);
  const textLength = content && content !== LOADING_FLAT ? content.length : 0;
  // Text that has settled (rendered statically, or shown by an earlier mount)
  // does not re-enter streaming until it grows: switching back remounts the
  // stream renderer, which replays the fade over everything already shown.
  const [settledLength, setSettledLength] = useState(() => shownTextLengths.get(id));
  if (textLength > 0 && !enableStreamOption && settledLength !== textLength)
    setSettledLength(textLength);
  useEffect(() => {
    if (textLength > 0) shownTextLengths.set(id, textLength);
  }, [id, textLength]);

  const settled = settledLength !== undefined && textLength <= settledLength;
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
