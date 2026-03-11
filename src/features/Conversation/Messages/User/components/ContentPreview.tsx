import { Button, Flexbox, MaskShadow } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import MarkdownMessage from '@/features/Conversation/Markdown';
import { useChatStore } from '@/store/chat';

interface ContentPreviewProps {
  content: string;
  id: string;
}

const ContentPreview = ({ content, id }: ContentPreviewProps) => {
  const { t } = useTranslation('chat');

  const [openMessageDetail] = useChatStore((s) => [s.openMessageDetail]);

  return (
    <Flexbox>
      <MaskShadow>
        <MarkdownMessage>{content.slice(0, 1000)}</MarkdownMessage>
      </MaskShadow>
      <Flexbox padding={4}>
        <Button
          block
          color={'default'}
          size={'small'}
          variant={'filled'}
          onClick={() => {
            openMessageDetail(id);
          }}
        >
          {t('chatList.longMessageDetail')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};
export default ContentPreview;
