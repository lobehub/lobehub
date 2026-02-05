import { Button, Flexbox, MaskShadow } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import MarkdownMessage from '@/features/Conversation/Markdown';

import { useConversationStore } from '../../../store';

interface CollapsedMessageProps {
  content: string;
  id: string;
}

export const CollapsedMessage = memo<CollapsedMessageProps>(({ id, content }) => {
  const { t } = useTranslation('chat');
  const toggleMessageCollapsed = useConversationStore((s) => s.toggleMessageCollapsed);

  return (
    <Flexbox>
      <MaskShadow>
        <MarkdownMessage variant={'chat'}>{content?.slice(0, 300)}</MarkdownMessage>
      </MaskShadow>
      <Flexbox padding={4}>
        <Button
          block
          color={'default'}
          size={'small'}
          variant={'filled'}
          onClick={() => {
            toggleMessageCollapsed(id, false);
          }}
        >
          {t('chatList.expandMessage')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});
