'use client';

import { Button, createModal, Flexbox, Text, TextArea, useModalContext } from '@lobehub/ui';
import { t } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { frostedModalStyles } from '../Review/modals';

interface CollaborationRequestContentProps {
  /** Send the request with an optional reason; resolve true to close. */
  onSubmit: (reason: string) => Promise<boolean>;
}

const CollaborationRequestContent = ({ onSubmit }: CollaborationRequestContentProps) => {
  const { t: translate } = useTranslation('verify');
  const { close } = useModalContext();
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      if (await onSubmit(reason.trim())) close();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flexbox gap={16}>
      <Text type={'secondary'}>{translate('acceptance.access.description')}</Text>
      <TextArea
        autoSize={{ maxRows: 6, minRows: 3 }}
        maxLength={2000}
        placeholder={translate('acceptance.access.reasonPlaceholder')}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={loading} onClick={close}>
          {translate('acceptance.actions.cancel')}
        </Button>
        <Button loading={loading} type={'primary'} onClick={() => void submit()}>
          {translate('acceptance.access.submit')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

/** Ask for edit-collaboration, with room to say why. */
export const openCollaborationRequestModal = (props: CollaborationRequestContentProps) =>
  createModal({
    content: <CollaborationRequestContent {...props} />,
    footer: null,
    maskClosable: true,
    styles: frostedModalStyles,
    title: t('acceptance.access.request', { ns: 'verify' }),
    width: 'min(90vw, 480px)',
  });
