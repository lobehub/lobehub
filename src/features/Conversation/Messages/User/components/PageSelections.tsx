import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Code2Icon, SquareDashedMousePointer } from 'lucide-react';
import { memo } from 'react';

import type { ContextSelection, ElementContextSelection, PageSelection } from '@/types/index';

type UserContextSelection = ContextSelection | PageSelection;

const styles = stylex.create({
  codeContainer: {
    cursor: 'pointer',
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorBorder },
    borderRadius: '8px',
    backgroundColor: { 'default': cssVar.colorFillQuaternary, ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
  },
  codeContent: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '4',
    margin: '0',
    paddingBlock: '8px',
    paddingInline: '10px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    lineHeight: 1.55,
    color: cssVar.colorTextSecondary,
    whiteSpace: 'pre',
  },
  codeHeader: {
    overflow: 'hidden',
    alignItems: 'center',
    paddingBlock: '6px',
    paddingInline: '10px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    color: cssVar.colorTextTertiary,
  },
  codeMeta: {
    overflow: 'hidden',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  container: {
    cursor: 'pointer',
    position: 'relative',
    borderRadius: '8px',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  content: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '3',
    fontSize: '12px',
    lineHeight: 1.5,
    color: cssVar.colorTextSecondary,
    whiteSpace: 'pre-wrap',
  },
  elementText: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '3',
    paddingBlock: '8px',
    paddingInline: '10px',
    fontSize: '12px',
    lineHeight: 1.5,
    color: cssVar.colorTextSecondary,
  },
  elementThumbnail: {
    display: 'block',
    maxWidth: '100%',
    maxHeight: '200px',
    marginBlock: '8px',
    marginInline: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '6px',
    objectFit: 'contain',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  quote: {
    insetBlockStart: '2px',
    insetInlineStart: 0,
    fontFamily: 'Georgia, serif',
    fontSize: '28px',
    lineHeight: 1,
    color: cssVar.colorTextQuaternary,
  },
});

interface PageSelectionsProps {
  selections: UserContextSelection[];
}

const isContextSelection = (selection: UserContextSelection): selection is ContextSelection =>
  'source' in selection;

const isCodeSelection = (selection: UserContextSelection): selection is ContextSelection =>
  isContextSelection(selection) && selection.source === 'code';

const isElementSelection = (
  selection: UserContextSelection,
): selection is ElementContextSelection =>
  isContextSelection(selection) && selection.source === 'element';

const getCodeSelectionMeta = (selection: ContextSelection): string => {
  if (selection.source !== 'code') return selection.title || '';

  const lineRange = selection.lineRange
    ? `:${selection.lineRange.startLine}-${selection.lineRange.endLine ?? selection.lineRange.startLine}`
    : '';

  return `${selection.filePath}${lineRange}`;
};

const CodeSelection = memo<{ selection: ContextSelection }>(({ selection }) => (
  <Flexbox className={stylex.props(styles.codeContainer).className}>
    <Flexbox horizontal className={stylex.props(styles.codeHeader).className} gap={6}>
      <Code2Icon size={14} />
      <div {...stylex.props(styles.codeMeta)}>{getCodeSelectionMeta(selection)}</div>
    </Flexbox>
    <pre {...stylex.props(styles.codeContent)}>{selection.content}</pre>
  </Flexbox>
));

CodeSelection.displayName = 'UserMessageCodeSelection';

/** A picked DOM element renders as what it is — its crop and locator, not a quote. */
const ElementSelection = memo<{ selection: ElementContextSelection }>(({ selection }) => (
  <Flexbox className={stylex.props(styles.codeContainer).className}>
    <Flexbox horizontal className={stylex.props(styles.codeHeader).className} gap={6}>
      <SquareDashedMousePointer size={14} />
      <div {...stylex.props(styles.codeMeta)}>
        {selection.element.selector || `<${selection.element.tag}>`}
      </div>
    </Flexbox>
    {selection.element.thumbnailUrl ? (
      <img
        alt={selection.element.selector || selection.element.tag}
        {...stylex.props(styles.elementThumbnail)}
        src={selection.element.thumbnailUrl}
      />
    ) : (
      <div {...stylex.props(styles.elementText)}>{selection.preview || selection.content}</div>
    )}
  </Flexbox>
));

ElementSelection.displayName = 'UserMessageElementSelection';

const QuoteSelection = memo<{ selection: UserContextSelection }>(({ selection }) => (
  <Flexbox className={stylex.props(styles.container).className}>
    <Flexbox horizontal gap={4} padding={4}>
      <span {...stylex.props(styles.quote)}>"</span>
      <div {...stylex.props(styles.content)}>{selection.content}</div>
    </Flexbox>
  </Flexbox>
));

QuoteSelection.displayName = 'UserMessageQuoteSelection';

const SelectionItem = memo<{ selection: UserContextSelection }>(({ selection }) => {
  if (isCodeSelection(selection)) return <CodeSelection selection={selection} />;
  if (isElementSelection(selection)) return <ElementSelection selection={selection} />;

  return <QuoteSelection selection={selection} />;
});

SelectionItem.displayName = 'UserMessageSelectionItem';

const PageSelections = memo<PageSelectionsProps>(({ selections }) => {
  if (!selections || selections.length === 0) return null;

  return (
    <Flexbox gap={8}>
      {selections.map((selection) => (
        <SelectionItem key={selection.id} selection={selection} />
      ))}
    </Flexbox>
  );
});

export default PageSelections;
