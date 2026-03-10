import { Block, Flexbox, Input, Popover, stopPropagation } from '@lobehub/ui';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import EmojiPicker from '@/components/EmojiPicker';
import { useIsDark } from '@/hooks/useIsDark';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { usePageStore } from '@/store/page';

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

  const editing = usePageStore((s) => s.renamingPageId === documentId);

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

        await usePageStore.getState().renamePage(documentId, updates.title || title, updates.emoji);
      } catch (error) {
        console.error('Failed to update page:', error);
      }
    }
    toggleEditing(false);
  }, [newTitle, newEmoji, title, currentEmoji, documentId, toggleEditing]);

  return (
    <Popover
      open={editing}
      placement="bottomLeft"
      trigger="click"
      content={
        <Flexbox horizontal gap={4} style={{ width: 320 }} onClick={stopPropagation}>
          <EmojiPicker
            allowDelete
            defaultAvatar={'📄'}
            locale={locale}
            value={newEmoji}
            customRender={(emoji) => (
              <Block
                clickable
                align={'center'}
                height={36}
                justify={'center'}
                variant={isDarkMode ? 'filled' : 'outlined'}
                width={36}
                onClick={stopPropagation}
              >
                {emoji ? (
                  <span style={{ fontSize: 20 }}>{emoji}</span>
                ) : (
                  <span style={{ fontSize: 20 }}>📄</span>
                )}
              </Block>
            )}
            onChange={setNewEmoji}
            onClick={(e) => e?.stopPropagation()}
            onDelete={() => setNewEmoji(undefined)}
          />
          <Input
            autoFocus
            defaultValue={title}
            placeholder={t('pageEditor.titlePlaceholder')}
            style={{ flex: 1 }}
            onChange={(e) => setNewTitle(e.target.value)}
            onPressEnter={() => {
              handleUpdate();
              toggleEditing(false);
            }}
          />
        </Flexbox>
      }
      styles={{
        content: {
          padding: 4,
        },
      }}
      onOpenChange={(open) => {
        if (!open) handleUpdate();
        toggleEditing(open);
      }}
    >
      <div />
    </Popover>
  );
});

export default Editing;
