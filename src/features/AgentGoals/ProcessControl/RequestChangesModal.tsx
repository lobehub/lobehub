'use client';

import { Flexbox } from '@lobehub/ui';
import {
  Button,
  createModal,
  type ModalInstance,
  Text,
  TextArea,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { t } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * 提出修改 on a Goal's delivery. Unlike the acceptance page's reject, the
 * feedback is required: it is the only instruction the Agent gets for the
 * next round, and an empty "please change it" hands over nothing to act on.
 */

interface RequestChangesContentProps {
  /** Send the feedback; resolve true to close. */
  onConfirm: (comment: string) => Promise<boolean>;
}

const RequestChangesContent = ({ onConfirm }: RequestChangesContentProps) => {
  const { t } = useTranslation('chat');
  const { close } = useModalContext();
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const empty = comment.trim().length === 0;

  const submit = async () => {
    setTouched(true);
    if (empty) return;
    setLoading(true);
    try {
      if (await onConfirm(comment.trim())) close();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flexbox gap={12}>
      <Text fontSize={13} type={'secondary'}>
        {t('goalProcess.result.signOff.changes.description')}
      </Text>
      <TextArea
        autoFocus
        aria-invalid={touched && empty}
        autoSize={{ maxRows: 8, minRows: 4 }}
        placeholder={t('goalProcess.result.signOff.changes.placeholder')}
        style={touched && empty ? { borderColor: cssVar.colorError } : undefined}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />
      {touched && empty && (
        <Text fontSize={12} style={{ color: cssVar.colorError }}>
          {t('goalProcess.result.signOff.changes.required')}
        </Text>
      )}
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={loading} onClick={close}>
          {t('goalProcess.result.signOff.cancel')}
        </Button>
        <Button loading={loading} type={'primary'} onClick={submit}>
          {t('goalProcess.result.signOff.changes.submit')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

export const openRequestChangesModal = (props: RequestChangesContentProps): ModalInstance =>
  createModal({
    content: <RequestChangesContent {...props} />,
    footer: null,
    maskClosable: true,
    title: t('goalProcess.result.signOff.changes.title', { ns: 'chat' }),
    width: 'min(90vw, 520px)',
  });
