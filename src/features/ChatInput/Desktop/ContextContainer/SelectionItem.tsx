import type { ChatContextContent } from '@lobechat/types';
import { Tag, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Code2Icon, FileTextIcon, TextIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatInputStore } from '@/features/ChatInput/store';
import { useFileStore } from '@/store/file';

import { getFileSelectionLocation } from '../../utils/fileSelectionLocation';

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
  filePreview: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '8',
    paddingBlockStart: '6px',
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
  ({ content, filePath, id, lineRange, pageRange, preview, source, title }) => {
    const { t } = useTranslation('chat');
    const contextSelectionKey = useChatInputStore((s) => s.contextSelectionKey);
    const [removeSelection] = useFileStore((s) => [s.removeChatContextSelection]);

    const isFileSelection = source === 'file';
    const displayText = useMemo(
      () =>
        isFileSelection
          ? getPreviewText(content)
          : getPreviewText(preview || getLocationText({ filePath, lineRange, title }), content),
      [content, filePath, isFileSelection, lineRange, preview, title],
    );
    const isCodeSelection = source === 'code' || Boolean(filePath);

    const tooltip = useMemo(() => {
      if (isFileSelection) {
        return (
          <div>
            <div {...stylex.props(styles.meta)}>
              {getFileSelectionLocation({ pageRange, title }, t)}
            </div>
            <div {...stylex.props(styles.textPreview, styles.filePreview)}>{content}</div>
          </div>
        );
      }

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
    }, [
      content,
      filePath,
      isCodeSelection,
      isFileSelection,
      lineRange,
      pageRange,
      preview,
      t,
      title,
    ]);

    const icon = isFileSelection ? (
      <FileTextIcon size={16} />
    ) : isCodeSelection ? (
      <Code2Icon size={16} />
    ) : (
      <TextIcon size={16} />
    );

    return (
      <Tag
        closable
        icon={icon}
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
