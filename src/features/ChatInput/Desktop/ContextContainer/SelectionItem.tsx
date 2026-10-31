import type { ChatContextContent } from '@lobechat/types';
import { Tag, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Code2Icon, TextIcon } from 'lucide-react';
import { memo, useMemo } from 'react';

import { useChatInputStore } from '@/features/ChatInput/store';
import { useFileStore } from '@/store/file';

const styles = stylex.create({
  codeLine: { display: 'grid', gridTemplateColumns: '36px minmax(0, 1fr)', gap: '10px' },
  codePreview: {
    overflow: 'auto',
    maxWidth: 'min(560px, 80vw)',
    maxHeight: '220px',
    margin: '0',
    paddingBlock: '8px',
    paddingInline: '0',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    lineHeight: 1.55,
  },
  content: {
    overflow: 'hidden',
    minWidth: '0',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'pre',
  },
  lineNumber: { userSelect: 'none', color: cssVar.colorTextQuaternary, textAlign: 'end' },
  meta: {
    overflow: 'hidden',
    maxWidth: 'min(560px, 80vw)',
    paddingBlockEnd: '6px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  name: {
    overflow: 'hidden',
    flex: '1',
    minWidth: '0',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  textPreview: { maxWidth: 'min(420px, 70vw)', color: cssVar.colorText, whiteSpace: 'pre-wrap' },
  truncated: { paddingBlockStart: '4px', color: cssVar.colorTextQuaternary },
});

const MAX_PREVIEW_LENGTH = 8;
const MAX_CODE_PREVIEW_LINES = 8;

const getPreviewText = (content?: string, fallback?: string) => {
  const source = content || fallback || '';
  if (!source) return 'Text selection';

  const plain = source
    .replaceAll(/<[^>]*>/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
  if (!plain) return 'Text selection';

  return plain.length > MAX_PREVIEW_LENGTH ? `${plain.slice(0, MAX_PREVIEW_LENGTH)}...` : plain;
};

const getLocationText = ({
  filePath,
  lineRange,
  title,
}: Pick<ChatContextContent, 'filePath' | 'lineRange' | 'title'>) => {
  const location = filePath || title;
  if (!location) return;

  if (!lineRange) return location;

  const endLine = lineRange.endLine ?? lineRange.startLine;
  return `${location}:${lineRange.startLine}-${endLine}`;
};

const SelectionItem = memo<ChatContextContent>(
  ({ content, filePath, id, lineRange, preview, source, title }) => {
    const contextSelectionKey = useChatInputStore((s) => s.contextSelectionKey);
    const [removeSelection] = useFileStore((s) => [s.removeChatContextSelection]);

    const displayText = useMemo(
      () => getPreviewText(preview || getLocationText({ filePath, lineRange, title }), content),
      [content, filePath, lineRange, preview, title],
    );
    const isCodeSelection = source === 'code' || Boolean(filePath);

    const tooltip = useMemo(() => {
      if (!isCodeSelection) {
        return <div {...stylex.props(styles.textPreview)}>{preview || content}</div>;
      }

      const lines = content.split('\n');
      const previewLines = lines.slice(0, MAX_CODE_PREVIEW_LINES);
      const startLine = lineRange?.startLine ?? 1;

      return (
        <div>
          <div {...stylex.props(styles.meta)}>
            {getLocationText({ filePath, lineRange, title }) || preview || title}
          </div>
          <pre {...stylex.props(styles.codePreview)}>
            {previewLines.map((line, index) => (
              <div {...stylex.props(styles.codeLine)} key={`${index}-${line}`}>
                <span {...stylex.props(styles.lineNumber)}>{startLine + index}</span>
                <code {...stylex.props(styles.content)}>{line || ' '}</code>
              </div>
            ))}
            {lines.length > MAX_CODE_PREVIEW_LINES && (
              <div {...stylex.props(styles.codeLine, styles.truncated)}>
                <span {...stylex.props(styles.lineNumber)}>...</span>
                <code {...stylex.props(styles.content)}>...</code>
              </div>
            )}
          </pre>
        </div>
      );
    }, [content, filePath, isCodeSelection, lineRange, preview, title]);

    return (
      <Tag
        closable
        icon={isCodeSelection ? <Code2Icon size={16} /> : <TextIcon size={16} />}
        size={'large'}
        onClose={() => {
          if (contextSelectionKey) removeSelection({ contextKey: contextSelectionKey, id });
        }}
      >
        <Tooltip title={tooltip}>
          <span {...stylex.props(styles.name)}>{displayText}</span>
        </Tooltip>
      </Tag>
    );
  },
);

SelectionItem.displayName = 'SelectionItem';

export default SelectionItem;
