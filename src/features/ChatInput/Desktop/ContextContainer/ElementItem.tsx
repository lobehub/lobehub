import type { ChatContextContent } from '@lobechat/types';
import { Tag, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { SquareDashedMousePointer } from 'lucide-react';
import { memo } from 'react';

import { useChatInputStore } from '@/features/ChatInput/store';
import { useFileStore } from '@/store/file';

const styles = stylex.create({
  name: { overflow: 'hidden', maxWidth: '200px', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  selector: {
    overflow: 'hidden',
    maxWidth: 'min(420px, 70vw)',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  tagBadge: {
    paddingBlock: '0',
    paddingInline: '4px',
    borderRadius: '4px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  thumbnail: {
    display: 'block',
    maxWidth: 'min(420px, 70vw)',
    maxHeight: '240px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '6px',
    objectFit: 'contain',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  tooltip: { maxWidth: 'min(460px, 75vw)' },
  url: {
    overflow: 'hidden',
    fontSize: '12px',
    color: cssVar.colorTextQuaternary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

/**
 * The chip for a DOM element picked from the in-app browser. Unlike a plain
 * text selection it shows what was picked: the tag badge in the chip, and the
 * element's own cropped screenshot in the tooltip.
 */
const ElementItem = memo<ChatContextContent>(({ element, id, preview }) => {
  const contextSelectionKey = useChatInputStore((s) => s.contextSelectionKey);
  const [removeSelection] = useFileStore((s) => [s.removeChatContextSelection]);
  if (!element) return null;

  const tooltip = (
    <div {...stylex.props(styles.tooltip)}>
      {element.thumbnailUrl && (
        <img
          alt={element.selector || element.tag}
          {...stylex.props(styles.thumbnail)}
          src={element.thumbnailUrl}
        />
      )}
      <div {...stylex.props(styles.selector)}>{element.selector || `<${element.tag}>`}</div>
      {(element.pageTitle || element.url) && (
        <div {...stylex.props(styles.url)}>{element.pageTitle || element.url}</div>
      )}
    </div>
  );

  return (
    <Tag
      closable
      icon={<SquareDashedMousePointer size={16} />}
      size={'large'}
      onClose={() => {
        if (contextSelectionKey) removeSelection({ contextKey: contextSelectionKey, id });
      }}
    >
      <Tooltip title={tooltip}>
        <span>
          <span {...stylex.props(styles.tagBadge)}>{`<${element.tag}>`}</span>{' '}
          <span {...stylex.props(styles.name)}>{preview}</span>
        </span>
      </Tooltip>
    </Tag>
  );
});

ElementItem.displayName = 'ElementItem';

export default ElementItem;
