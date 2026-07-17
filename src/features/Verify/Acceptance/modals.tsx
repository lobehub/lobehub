'use client';

import { Flexbox, Text, TextArea } from '@lobehub/ui';
import { Button, createModal, type ModalInstance, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { t } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  warning: css`
    padding-block: 10px;
    padding-inline: 14px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorWarningBg};
  `,
}));

interface AcceptContentProps {
  /** Titles of the exceptions the user is knowingly accepting with. */
  exceptions: string[];
  /** Perform the accept; resolve true to close, false to stay open (error shown by the page). */
  onConfirm: () => Promise<boolean>;
  subjectTitle: string;
}

const AcceptContent = memo<AcceptContentProps>(({ exceptions, onConfirm, subjectTitle }) => {
  const { t: translate } = useTranslation('verify');
  const { close } = useModalContext();
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      if (await onConfirm()) close();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flexbox gap={16}>
      <Text>{translate('acceptance.accept.summary', { title: subjectTitle })}</Text>
      {exceptions.length > 0 && (
        <Flexbox className={styles.warning} gap={4}>
          <Text strong fontSize={13}>
            {translate('acceptance.accept.exceptionsTitle', { count: exceptions.length })}
          </Text>
          {exceptions.map((title) => (
            <Text fontSize={12} key={title} type={'secondary'}>
              · {title}
            </Text>
          ))}
          <Text fontSize={12} type={'secondary'}>
            {translate('acceptance.accept.exceptionsHint')}
          </Text>
        </Flexbox>
      )}
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={loading} onClick={close}>
          {translate('acceptance.actions.cancel')}
        </Button>
        <Button loading={loading} type={'primary'} onClick={handleConfirm}>
          {translate('acceptance.actions.confirmAccept')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

AcceptContent.displayName = 'AcceptanceAcceptContent';

/** Accept confirmation — spells out the terminal event and the exceptions taken with it. */
export const openAcceptModal = (options: AcceptContentProps): ModalInstance =>
  createModal({
    content: <AcceptContent {...options} />,
    footer: null,
    maskClosable: true,
    title: t('acceptance.actions.accept', { ns: 'verify' }),
    width: 'min(90vw, 480px)',
  });

interface RejectContentProps {
  /** Perform the reject with the reason; resolve true to close. */
  onConfirm: (comment: string) => Promise<boolean>;
}

const RejectContent = memo<RejectContentProps>(({ onConfirm }) => {
  const { t: translate } = useTranslation('verify');
  const { close } = useModalContext();
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    const trimmed = comment.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      if (await onConfirm(trimmed)) close();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flexbox gap={16}>
      <Text fontSize={13} type={'secondary'}>
        {translate('acceptance.reject.description')}
      </Text>
      <TextArea
        autoSize={{ maxRows: 6, minRows: 3 }}
        placeholder={translate('acceptance.reject.placeholder')}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={loading} onClick={close}>
          {translate('acceptance.actions.cancel')}
        </Button>
        <Button
          disabled={!comment.trim()}
          loading={loading}
          type={'primary'}
          onClick={handleConfirm}
        >
          {translate('acceptance.actions.confirmReject')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

RejectContent.displayName = 'AcceptanceRejectContent';

/** Reject dialog — the reason is required: it is the next round's input, not a note. */
export const openRejectModal = (options: RejectContentProps): ModalInstance =>
  createModal({
    content: <RejectContent {...options} />,
    footer: null,
    maskClosable: true,
    title: t('acceptance.actions.reject', { ns: 'verify' }),
    width: 'min(90vw, 480px)',
  });

interface GroupFeedbackContentProps {
  groupLabel: string;
  /** Record the feedback; resolve true to close. */
  onConfirm: (comment: string) => Promise<boolean>;
}

const GroupFeedbackContent = memo<GroupFeedbackContentProps>(({ groupLabel, onConfirm }) => {
  const { t: translate } = useTranslation('verify');
  const { close } = useModalContext();
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    const trimmed = comment.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      if (await onConfirm(trimmed)) close();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flexbox gap={16}>
      <Text fontSize={13} type={'secondary'}>
        {translate('acceptance.group.feedbackDescription', { label: groupLabel })}
      </Text>
      <TextArea
        autoSize={{ maxRows: 8, minRows: 3 }}
        placeholder={translate('acceptance.group.feedbackPlaceholder')}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={loading} onClick={close}>
          {translate('acceptance.actions.cancel')}
        </Button>
        <Button
          disabled={!comment.trim()}
          loading={loading}
          type={'primary'}
          onClick={handleConfirm}
        >
          {translate('acceptance.group.feedbackSubmit')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

GroupFeedbackContent.displayName = 'AcceptanceGroupFeedbackContent';

/**
 * Group-scoped feedback dialog — the channel for concerns that belong to no
 * single check (which may well be accepted) yet must reach the next round.
 */
export const openGroupFeedbackModal = (options: GroupFeedbackContentProps): ModalInstance =>
  createModal({
    content: <GroupFeedbackContent {...options} />,
    footer: null,
    maskClosable: true,
    title: t('acceptance.group.feedbackTitle', { ns: 'verify' }),
    width: 'min(90vw, 520px)',
  });
