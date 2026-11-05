import { Markdown, type MarkdownProps } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type ComponentProps, isValidElement, memo, type ReactElement } from 'react';

import { sx } from '@/styles/sx';

const styles = stylex.create({
  h2: {
    fontSize: 16,
    fontWeight: 600,
    marginBlockEnd: 12,
    marginBlockStart: 24,
  },
  h3: {
    fontSize: 14,
    fontWeight: 500,
    marginBlockEnd: 8,
    marginBlockStart: 16,
  },
  li: {
    color: {
      default: null,
      [stylex.when.ancestor(':is(ul)')]: cssVar.colorTextSecondary,
    },
    fontSize: {
      default: null,
      [stylex.when.ancestor(':is(ul)')]: 14,
    },
    lineHeight: {
      default: null,
      [stylex.when.ancestor(':is(ul)')]: 1.6,
    },
    marginBlockEnd: {
      default: null,
      [stylex.when.ancestor(':is(ul)')]: 4,
    },
  },
  p: {
    color: cssVar.colorTextSecondary,
    fontSize: 14,
    lineHeight: 1.6,
    marginBlockEnd: 8,
  },
  strong: {
    color: cssVar.colorText,
    fontWeight: 500,
  },
  ul: {
    marginBlock: 8,
    marginInline: 0,
    paddingInlineStart: 20,
  },
});

type ElementProps<T extends 'h2' | 'h3' | 'li' | 'p' | 'strong' | 'ul'> = ComponentProps<T> & {
  node?: unknown;
};

const isMediaParagraph = (children: unknown) =>
  isValidElement(children) &&
  ['img', 'video'].includes(
    (children as ReactElement<{ node?: { tagName?: string } }>).props.node?.tagName ?? '',
  );

const components: MarkdownProps['components'] = {
  h2: ({ node: _node, className, style, ...rest }: ElementProps<'h2'>) => (
    <h2 {...rest} {...sx(styles.h2, className, style)} />
  ),
  h3: ({ node: _node, className, style, ...rest }: ElementProps<'h3'>) => (
    <h3 {...rest} {...sx(styles.h3, className, style)} />
  ),
  li: ({ node: _node, className, style, ...rest }: ElementProps<'li'>) => (
    <li {...rest} {...sx(styles.li, className, style)} />
  ),
  p: ({ children, className, style }: ElementProps<'p'>) => {
    if (isMediaParagraph(children)) return children;
    return <p {...sx(styles.p, className, style)}>{children}</p>;
  },
  strong: ({ node: _node, className, style, ...rest }: ElementProps<'strong'>) => (
    <strong {...rest} {...sx(styles.strong, className, style)} />
  ),
  ul: ({ node: _node, className, style, ...rest }: ElementProps<'ul'>) => (
    <ul {...rest} {...sx([stylex.defaultMarker(), styles.ul], className, style)} />
  ),
};

interface PersonaDetailProps {
  children: string;
}

const PersonaDetail = memo<PersonaDetailProps>(({ children }) => {
  return (
    <Markdown components={components} enableImageGallery={false} enableLatex={false}>
      {children}
    </Markdown>
  );
});

export default PersonaDetail;
