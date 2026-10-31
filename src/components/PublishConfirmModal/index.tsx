import { Button, createModal, Flexbox, ScrollArea, Text, useModalContext } from '@lobehub/ui';
import { t } from 'i18next';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

const CONFIRM_BODY_MAX_HEIGHT = 'min(52vh, 360px)';

const PublishConfirmContent = ({
  details,
  note,
  privacy,
}: {
  details?: ReactNode;
  note?: ReactNode;
  privacy?: ReactNode;
}) => {
  const { t } = useTranslation('chat');

  return (
    <ScrollArea
      disableContentFit
      scrollFade
      style={{ maxHeight: CONFIRM_BODY_MAX_HEIGHT, overflow: 'hidden' }}
      viewportProps={{ style: { height: 'auto', maxHeight: CONFIRM_BODY_MAX_HEIGHT } }}
    >
      <Flexbox gap={8} style={{ paddingBlock: 12, paddingInline: 16 }}>
        <Text>{privacy ?? t('workingPanel.localFile.publish.privacy')}</Text>
        {details}
        {note && <Text type={'secondary'}>{note}</Text>}
      </Flexbox>
    </ScrollArea>
  );
};

const PublishConfirmFooter = ({ okText, onOk }: { okText: string; onOk: () => void }) => {
  const { t } = useTranslation('common');
  const { close } = useModalContext();

  return (
    <Flexbox
      horizontal
      gap={8}
      justify={'flex-end'}
      style={{ paddingBlock: 12, paddingInline: 16 }}
    >
      <Button onClick={() => close()}>{t('cancel')}</Button>
      <Button
        type={'primary'}
        onClick={() => {
          close();
          onOk();
        }}
      >
        {okText}
      </Button>
    </Flexbox>
  );
};

export interface PublishConfirmOptions {
  details?: ReactNode;
  note?: ReactNode;
  okText: string;
  onOk: () => void;
  /** Replaces the default "anyone with the link" paragraph. */
  privacy?: ReactNode;
  /** Replaces the default publish-confirmation title. */
  title?: ReactNode;
}

export const openPublishConfirm = ({
  details,
  note,
  okText,
  onOk,
  privacy,
  title,
}: PublishConfirmOptions) => {
  createModal({
    content: <PublishConfirmContent details={details} note={note} privacy={privacy} />,
    footer: <PublishConfirmFooter okText={okText} onOk={onOk} />,
    styles: {
      content: { minHeight: 0, overflow: 'hidden', padding: 0 },
    },
    title: title ?? t('workingPanel.localFile.publish.confirmTitle', { ns: 'chat' }),
    width: 420,
  });
};
