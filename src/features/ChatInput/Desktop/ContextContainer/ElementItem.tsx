import type { ChatContextContent } from '@lobechat/types';
import { Tag, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { SquareDashedMousePointer } from 'lucide-react';
import { memo } from 'react';

import { useFileStore } from '@/store/file';

const styles = createStaticStyles(({ css }) => ({
  name: css`
    overflow: hidden;
    max-width: 200px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  selector: css`
    overflow: hidden;

    max-width: min(420px, 70vw);

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  tagBadge: css`
    padding-block: 0;
    padding-inline: 4px;
    border-radius: 4px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
  thumbnail: css`
    display: block;

    max-width: min(420px, 70vw);
    max-height: 240px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 6px;

    object-fit: contain;
    background: ${cssVar.colorBgContainer};
  `,
  tooltip: css`
    max-width: min(460px, 75vw);
  `,
  url: css`
    overflow: hidden;

    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

/**
 * The chip for a DOM element picked from the in-app browser. Unlike a plain
 * text selection it shows what was picked: the tag badge in the chip, and the
 * element's own cropped screenshot in the tooltip.
 */
const ElementItem = memo<ChatContextContent>(({ element, id, preview }) => {
  const [removeSelection] = useFileStore((s) => [s.removeChatContextSelection]);
  if (!element) return null;

  const tooltip = (
    <div className={styles.tooltip}>
      {element.thumbnailUrl && (
        <img
          alt={element.selector || element.tag}
          className={styles.thumbnail}
          src={element.thumbnailUrl}
        />
      )}
      <div className={styles.selector}>{element.selector || `<${element.tag}>`}</div>
      {(element.pageTitle || element.url) && (
        <div className={styles.url}>{element.pageTitle || element.url}</div>
      )}
    </div>
  );

  return (
    <Tag
      closable
      icon={<SquareDashedMousePointer size={16} />}
      size={'large'}
      onClose={() => removeSelection(id)}
    >
      <Tooltip title={tooltip}>
        <span>
          <span className={styles.tagBadge}>{`<${element.tag}>`}</span>{' '}
          <span className={styles.name}>{preview}</span>
        </span>
      </Tooltip>
    </Tag>
  );
});

ElementItem.displayName = 'ElementItem';

export default ElementItem;
