import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Code2Icon } from 'lucide-react';
import { memo } from 'react';

import type { ContextSelection, PageSelection } from '@/types/index';

type UserContextSelection = ContextSelection | PageSelection;

const styles = createStaticStyles(({ css, cssVar }) => ({
  codeContainer: css`
    cursor: pointer;

    overflow: hidden;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    background: ${cssVar.colorFillQuaternary};

    :hover {
      border-color: ${cssVar.colorBorder};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  codeContent: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;

    margin: 0;
    padding-block: 8px;
    padding-inline: 10px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    line-height: 1.55;
    color: ${cssVar.colorTextSecondary};
    white-space: pre;
  `,
  codeHeader: css`
    overflow: hidden;
    align-items: center;

    padding-block: 6px;
    padding-inline: 10px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    color: ${cssVar.colorTextTertiary};
  `,
  codeMeta: css`
    overflow: hidden;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  container: css`
    cursor: pointer;
    position: relative;
    border-radius: 8px;

    :hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  content: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;

    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
    white-space: pre-wrap;
  `,
  quote: css`
    inset-block-start: 2px;
    inset-inline-start: 0;

    font-family: Georgia, serif;
    font-size: 28px;
    line-height: 1;
    color: ${cssVar.colorTextQuaternary};
  `,
  wrapper: css``,
}));

interface PageSelectionsProps {
  selections: UserContextSelection[];
}

const isContextSelection = (selection: UserContextSelection): selection is ContextSelection =>
  'source' in selection;

const isCodeSelection = (selection: UserContextSelection): selection is ContextSelection =>
  isContextSelection(selection) && selection.source === 'code';

const getCodeSelectionMeta = (selection: ContextSelection): string => {
  if (selection.source !== 'code') return selection.title || '';

  const lineRange = selection.lineRange
    ? `:${selection.lineRange.startLine}-${selection.lineRange.endLine ?? selection.lineRange.startLine}`
    : '';

  return `${selection.filePath}${lineRange}`;
};

const CodeSelection = memo<{ selection: ContextSelection }>(({ selection }) => (
  <Flexbox className={styles.codeContainer}>
    <Flexbox horizontal className={styles.codeHeader} gap={6}>
      <Code2Icon size={14} />
      <div className={styles.codeMeta}>{getCodeSelectionMeta(selection)}</div>
    </Flexbox>
    <pre className={styles.codeContent}>{selection.content}</pre>
  </Flexbox>
));

CodeSelection.displayName = 'UserMessageCodeSelection';

const QuoteSelection = memo<{ selection: UserContextSelection }>(({ selection }) => (
  <Flexbox className={styles.container}>
    <Flexbox horizontal className={styles.wrapper} gap={4} padding={4}>
      <span className={styles.quote}>"</span>
      <div className={styles.content}>{selection.content}</div>
    </Flexbox>
  </Flexbox>
));

QuoteSelection.displayName = 'UserMessageQuoteSelection';

const SelectionItem = memo<{ selection: UserContextSelection }>(({ selection }) => {
  if (isCodeSelection(selection)) return <CodeSelection selection={selection} />;

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
