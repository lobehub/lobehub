import { Block, Flexbox, Input } from '@lobehub/ui';
import { Popover } from 'antd';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import EmojiPicker from '@/components/EmojiPicker';
import { useIsDark } from '@/hooks/useIsDark';
import { useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';

interface EditingProps {
  currentEmoji?: string;
  documentId: string;
  title: string;
  toggleEditing: (visible?: boolean) => void;
}

const Editing = memo<EditingProps>(({ documentId, title, currentEmoji, toggleEditing }) => {
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);
  const isDarkMode = useIsDark();
  const { t } = useTranslation('file');

  const editing = useFileStore((s) => s.renamingPageId === documentId);

  const [newTitle, setNewTitle] = useState(title);
  const [newEmoji, setNewEmoji] = useState(currentEmoji);

  const handleUpdate = useCallback(async () => {
    const hasChanges =
      (newTitle && title !== newTitle) || (newEmoji !== undefined && currentEmoji !== newEmoji);

    if (hasChanges) {
      try {
        const updates: { emoji?: string; title?: string } = {};
        if (newTitle && title !== newTitle) updates.title = newTitle;
        if (newEmoji !== undefined && currentEmoji !== newEmoji) updates.emoji = newEmoji;

        await useFileStore.getState().renamePage(documentId, updates.title || title, updates.emoji);
      } catch (error) {
        console.error('Failed to update page:', error);
      }
    }
    toggleEditing(false);
  }, [newTitle, newEmoji, title, currentEmoji, documentId, toggleEditing]);

  return (
    <Popover
      arrow={false}
      content={
        <Flexbox gap={4} horizontal onClick={(e) => e.stopPropagation()} style={{ width: 320 }}>
          <EmojiPicker
            allowDelete
            customRender={(emoji) => (
              <Block
                align={'center'}
                clickable
                height={36}
                justify={'center'}
                onClick={(e) => e.stopPropagation()}
                variant={isDarkMode ? 'filled' : 'outlined'}
                width={36}
              >
                {emoji ? (
                  <span style={{ fontSize: 20 }}>{emoji}</span>
                ) : (
                  <span style={{ fontSize: 20 }}>📄</span>
                )}
              </Block>
            )}
            defaultAvatar={'📄'}
            locale={locale}
            onChange={setNewEmoji}
            onDelete={() => setNewEmoji(undefined)}
            value={newEmoji}
          />
          <Input
            autoFocus
            defaultValue={title}
            onChange={(e) => setNewTitle(e.target.value)}
            onPressEnter={() => {
              handleUpdate();
              toggleEditing(false);
            }}
            placeholder={t('pageEditor.titlePlaceholder')}
            style={{ flex: 1 }}
          />
        </Flexbox>
      }
      destroyOnHidden
      onOpenChange={(open) => {
        if (!open) handleUpdate();
        toggleEditing(open);
      }}
      open={editing}
      placement={'bottomLeft'}
      styles={{
        container: {
          padding: 4,
        },
      }}
      trigger={['click']}
    >
      <div />
    </Popover>
  );
});

export default Editing;
