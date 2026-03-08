import { type MarkdownProps } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { useMemo } from 'react';

import { markdownElements } from '../../Markdown/plugins';
import ContentPreview from './components/ContentPreview';

const rehypePlugins = markdownElements
  .filter((s) => s.scope !== 'assistant')
  .map((element) => element.rehypePlugin)
  .filter(Boolean);

const remarkPlugins = markdownElements
  .filter((s) => s.scope !== 'assistant')
  .map((element) => element.remarkPlugin)
  .filter(Boolean);

// Override heading components to render as plain text
// This prevents markdown heading syntax (# ## ###) from being styled as headings in user messages
const PlainTextHeading = ({ children }: { children: ReactNode }) => <>{children}</>;

export const useMarkdown = (id: string): Partial<MarkdownProps> => {
  return useMemo(
    () =>
      ({
        components: {
          ...Object.fromEntries(
            markdownElements.map((element) => {
              const Component = element.Component;
              return [element.tag, (props: any) => <Component {...props} id={id} />];
            }),
          ),
          // Override heading tags to render as plain text
          h1: PlainTextHeading,
          h2: PlainTextHeading,
          h3: PlainTextHeading,
          h4: PlainTextHeading,
          h5: PlainTextHeading,
          h6: PlainTextHeading,
        } as any,
        customRender: (dom: ReactNode, { text }: { text: string }) => {
          if (text.length > 30_000) return <ContentPreview content={text} id={id} />;
          return dom;
        },
        enableStream: false,
        rehypePlugins,
        remarkPlugins,
      }) satisfies Partial<MarkdownProps>,
    [id],
  );
};
