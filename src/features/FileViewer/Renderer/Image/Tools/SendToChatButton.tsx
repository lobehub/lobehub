'use client';

import { Button } from '@lobehub/ui/base-ui';
import { MessageSquareShareIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { type ImageMarkup, isMarkupEmpty } from './markup';
import { useSendMarkupToChat } from './useSendMarkupToChat';

interface SendToChatButtonProps {
  markup: ImageMarkup;
  /** Called once the marks are in the chat input; the viewer clears them. */
  onSent: () => void;
}

/**
 * Primary action of annotate and comment: put the marked-up image and the
 * numbered comments into the chat input. Without a conversation next to the
 * viewer, it starts one with the inbox agent instead.
 */
const SendToChatButton = ({ markup, onSent }: SendToChatButtonProps) => {
  const { t } = useTranslation('file');
  const { hasComposer, send, sending } = useSendMarkupToChat();
  const empty = isMarkupEmpty(markup);

  return (
    <Button
      data-testid={'image-markup-send'}
      disabled={empty}
      icon={MessageSquareShareIcon}
      loading={sending}
      shape={'round'}
      size={'small'}
      title={empty ? t('imageViewer.markup.empty') : undefined}
      type={'primary'}
      onClick={async () => {
        if (await send(markup)) onSent();
      }}
    >
      {t(hasComposer ? 'imageViewer.markup.addToChat' : 'imageViewer.markup.askInNewChat')}
    </Button>
  );
};

export default SendToChatButton;
