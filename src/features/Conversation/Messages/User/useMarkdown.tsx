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

export const useMarkdown = (id: string): Partial<MarkdownProps> => {
  const components = useMemo(
    () =>
      Object.fromEntries(
        markdownElements.map((element) => {
          const Component = element.Component;
          return [element.tag, (props: any) => <Component {...props} id={id} />];
        }),
      ),
    [id],
  );

  return useMemo(
    () =>
      ({
        components: Object.fromEntries(
          markdownElements.map((element) => {
            const Component = element.Component;
            return [element.tag, (props: any) => <Component {...props} id={id} />];
          }),
        ) as any,
        customRender: (dom: ReactNode, { text }: { text: string }) => {
          if (text.length > 30_000) return <ContentPreview content={text} id={id} />;
          return dom;
        },
        enableStream: false,
        rehypePlugins,
        remarkPlugins,
      }) satisfies Partial<MarkdownProps>,
    [components],
  );
};
