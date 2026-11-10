'use client';

import { MessageSquareShareIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import BarButton from './BarButton';
import { type ImageMarkup, isMarkupEmpty } from './markup';
import { useSendMarkupToChat } from './useSendMarkupToChat';

interface SendToChatButtonProps {
  markup: ImageMarkup;
  /** Commit anything still being edited and return the marks to send. */
  onBeforeSend?: () => ImageMarkup;
  /** Called with the marks that went into the chat input, so only those are cleared. */
  onSent: (sent: ImageMarkup) => void;
}

/**
 * Primary action of annotate and comment: put the marked-up image and the
 * numbered comments into the chat input. Without a conversation next to the
 * viewer, it starts one with the inbox agent instead.
 */
const SendToChatButton = ({ markup, onBeforeSend, onSent }: SendToChatButtonProps) => {
  const { t } = useTranslation('file');
  const { hasComposer, send, sending } = useSendMarkupToChat();
  const empty = isMarkupEmpty(markup);

  return (
    <BarButton
      data-testid={'image-markup-send'}
      disabled={empty}
      icon={MessageSquareShareIcon}
      label={t(hasComposer ? 'imageViewer.markup.addToChat' : 'imageViewer.markup.askInNewChat')}
      loading={sending}
      title={empty ? t('imageViewer.markup.empty') : undefined}
      type={'primary'}
      onClick={async () => {
        const toSend = onBeforeSend?.() ?? markup;
        if (await send(toSend)) onSent(toSend);
      }}
    />
  );
};

export default SendToChatButton;
