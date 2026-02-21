import { type ChatContextContent } from '@lobechat/types';
import { Tag, Tooltip } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { TextIcon } from 'lucide-react';
import { memo, useMemo } from 'react';

import { useFileStore } from '@/store/file';

const styles = createStaticStyles(({ css }) => ({
  name: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const MAX_PREVIEW_LENGTH = 8;

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

const SelectionItem = memo<ChatContextContent>(({ preview, id }) => {
  const [removeSelection] = useFileStore((s) => [s.removeChatContextSelection]);

  const displayText = useMemo(() => getPreviewText(preview), [preview]);

  return (
    <Tag closable icon={<TextIcon size={16} />} size={'large'} onClose={() => removeSelection(id)}>
      <Tooltip title={preview}>
        <span className={styles.name}>{displayText}</span>
      </Tooltip>
    </Tag>
  );
});

SelectionItem.displayName = 'SelectionItem';

export default SelectionItem;
