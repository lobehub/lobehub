'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import {
  Avatar,
  Button,
  createModal,
  type ModalInstance,
  Text,
  TextArea,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { t } from 'i18next';
import { ChevronDown, ChevronUp, MessagesSquare } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AttachmentStrip,
  AttachmentThumbs,
  AttachmentUploadButton,
  useFeedbackAttachments,
} from '../Evidence/attachments';
import type { RejectFeedbackItem } from './rejectFeedback';

const styles = createStaticStyles(({ css }) => ({
  avatarStack: css`
    flex: none;

    > * + * {
      margin-inline-start: -6px;
      box-shadow: 0 0 0 2px ${cssVar.colorBgElevated};
    }
  `,
  included: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  includedBody: css`
    padding-block: 0 10px;
    padding-inline: 12px;
  `,
  includedList: css`
    overflow-y: auto;
    max-height: 240px;
  `,
  includedRow: css`
    padding-block: 10px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: none;
    }
  `,
  includedSummary: css`
    padding-block: 10px;
    padding-inline: 12px;
  `,
  includedToggle: css`
    cursor: pointer;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  warning: css`
    padding-block: 10px;
    padding-inline: 14px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorWarningBg};
  `,
}));

/**
 * A frosted scrim for the acceptance decision dialogs — the page behind reads
 * as a soft blur so the dialog owns focus (matches the antd modal mask, which
 * already blurs). Applied per-modal via `styles.backdrop`; a global backdrop
 * rule can't be used because base-ui popups (Select/Menu lists) share the same
 * `role=presentation` element and would frost their own content.
 */
export const frostedModalStyles = { backdrop: { backdropFilter: 'blur(4px)' } };

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
    styles: frostedModalStyles,
    title: t('acceptance.actions.accept', { ns: 'verify' }),
    width: 'min(90vw, 480px)',
  });

const IncludedFeedbackRow = memo<{ item: RejectFeedbackItem }>(({ item }) => {
  const { t: translate } = useTranslation('verify');
  const scope = item.checkSeq ? `C${item.checkSeq} ${item.title ?? ''}` : item.title;
  const metaBits = [
    scope,
    item.annotationCount
      ? translate('acceptance.feedback.annotations', { count: item.annotationCount })
      : null,
  ].filter(Boolean);

  return (
    <Flexbox horizontal className={styles.includedRow} gap={8}>
      {/* First character only — a two-character CJK name wraps in a small circle. */}
      <Avatar avatar={item.authorAvatar || item.authorName.slice(0, 1)} size={20} />
      <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
        <Flexbox horizontal align={'baseline'} gap={6} style={{ minWidth: 0 }}>
          <Text strong fontSize={12} style={{ flex: 'none' }}>
            {item.authorName}
          </Text>
          {metaBits.length > 0 && (
            <Text ellipsis fontSize={11} type={'secondary'}>
              {metaBits.join(' · ')}
            </Text>
          )}
        </Flexbox>
        {item.text && (
          <Text ellipsis={{ rows: 2 }} fontSize={12}>
            {item.text}
          </Text>
        )}
        <AttachmentThumbs attachments={item.attachments} />
      </Flexbox>
    </Flexbox>
  );
});

IncludedFeedbackRow.displayName = 'AcceptanceRejectIncludedFeedbackRow';

interface RejectContentProps {
  /** The rounds name an authoring agent — the server sends the reject back to
      it. Without one the dialog promises no next round: it copies the prompt. */
  dispatchAvailable: boolean;
  /** Open feedback the repair agent reads alongside the reason — previewed so
      the reviewer knows whose comments and screenshots ride along. */
  feedback?: RejectFeedbackItem[];
  /** Perform the reject with an optional reason; resolve true to close. */
  onConfirm: (comment: string) => Promise<boolean>;
}

const RejectContent = memo<RejectContentProps>(
  ({ dispatchAvailable, feedback = [], onConfirm }) => {
    const { t: translate } = useTranslation('verify');
    const { close } = useModalContext();
    const [comment, setComment] = useState('');
    const [loading, setLoading] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);
    const mineCount = feedback.filter((item) => item.mine).length;

    const handleConfirm = async () => {
      const trimmed = comment.trim();
      setLoading(true);
      try {
        if (await onConfirm(trimmed)) close();
      } finally {
        setLoading(false);
      }
    };

    // Distinct faces behind the queued feedback, for the summary bar.
    const authors = [
      ...new Map(feedback.map((item) => [item.authorName, item.authorAvatar])).entries(),
    ].slice(0, 3);

    return (
      <Flexbox gap={16}>
        {/* What the repair prompt carries besides the reason leads the dialog —
            otherwise nobody can tell whether teammates' notes go along. */}
        {feedback.length > 0 ? (
          <Flexbox className={styles.included}>
            <Flexbox
              horizontal
              align={'center'}
              aria-expanded={previewOpen}
              className={cx(styles.includedSummary, styles.includedToggle)}
              gap={8}
              role={'button'}
              tabIndex={0}
              onClick={() => setPreviewOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setPreviewOpen((open) => !open);
                }
              }}
            >
              <Icon icon={MessagesSquare} size={16} />
              <Text strong fontSize={13} style={{ flex: 1, minWidth: 0 }}>
                {translate('acceptance.reject.included', {
                  count: feedback.length,
                  mine: mineCount,
                  others: feedback.length - mineCount,
                })}
              </Text>
              <Flexbox horizontal className={styles.avatarStack}>
                {authors.map(([name, avatar]) => (
                  <Avatar avatar={avatar || name.slice(0, 1)} key={name} size={20} />
                ))}
              </Flexbox>
              <Icon icon={previewOpen ? ChevronUp : ChevronDown} size={14} />
            </Flexbox>
            {previewOpen && (
              <Flexbox className={styles.includedBody} gap={4}>
                <Text fontSize={12} type={'secondary'}>
                  {translate('acceptance.reject.includedHint')}
                </Text>
                <Flexbox className={styles.includedList}>
                  {feedback.map((item) => (
                    <IncludedFeedbackRow item={item} key={item.key} />
                  ))}
                </Flexbox>
              </Flexbox>
            )}
          </Flexbox>
        ) : (
          <Flexbox
            horizontal
            align={'center'}
            className={cx(styles.included, styles.includedSummary)}
            gap={8}
          >
            <Icon color={cssVar.colorTextTertiary} icon={MessagesSquare} size={16} />
            <Text fontSize={13} type={'secondary'}>
              {translate('acceptance.reject.includedNone')}
            </Text>
          </Flexbox>
        )}
        <Text fontSize={13} type={'secondary'}>
          {translate(
            dispatchAvailable
              ? 'acceptance.reject.description'
              : 'acceptance.reject.descriptionCopy',
          )}
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
          <Button loading={loading} type={'primary'} onClick={handleConfirm}>
            {translate(
              dispatchAvailable
                ? 'acceptance.actions.confirmReject'
                : 'acceptance.actions.confirmRejectCopy',
            )}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

RejectContent.displayName = 'AcceptanceRejectContent';

/** Reject dialog — an optional reason adds context for the next repair round. */
export const openRejectModal = (options: RejectContentProps): ModalInstance =>
  createModal({
    content: <RejectContent {...options} />,
    footer: null,
    maskClosable: true,
    styles: frostedModalStyles,
    title: t('acceptance.actions.reject', { ns: 'verify' }),
    width: 'min(90vw, 520px)',
  });

interface GroupFeedbackContentProps {
  /** Override the group-scoped description (the decision bar's global note). */
  description?: string;
  groupLabel: string;
  /** Record the feedback (note + any screenshots); resolve true to close. */
  onConfirm: (comment: string, fileIds: string[]) => Promise<boolean>;
}

const GroupFeedbackContent = memo<GroupFeedbackContentProps>(
  ({ description, groupLabel, onConfirm }) => {
    const { t: translate } = useTranslation('verify');
    const { close } = useModalContext();
    const [comment, setComment] = useState('');
    const [loading, setLoading] = useState(false);
    const { attachments, fileIds, handlePaste, remove, uploadFiles, uploading } =
      useFeedbackAttachments();

    const handleConfirm = async () => {
      const trimmed = comment.trim();
      if (!trimmed) return;
      setLoading(true);
      try {
        if (await onConfirm(trimmed, fileIds)) close();
      } finally {
        setLoading(false);
      }
    };

    return (
      <Flexbox gap={16}>
        <Text fontSize={13} type={'secondary'}>
          {description ?? translate('acceptance.group.feedbackDescription', { label: groupLabel })}
        </Text>
        <Flexbox gap={8}>
          <TextArea
            autoSize={{ maxRows: 8, minRows: 3 }}
            placeholder={translate('acceptance.group.feedbackPlaceholder')}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            onPaste={handlePaste}
          />
          {/* One row hugging the input — attachments belong to the note. */}
          <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
            <AttachmentStrip
              attachments={attachments}
              disabled={loading}
              uploading={uploading}
              onRemove={remove}
            />
            <AttachmentUploadButton disabled={loading} onFiles={uploadFiles} />
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={8} justify={'flex-end'}>
          <Button disabled={loading} onClick={close}>
            {translate('acceptance.actions.cancel')}
          </Button>
          <Button
            disabled={!comment.trim() || uploading}
            loading={loading}
            type={'primary'}
            onClick={handleConfirm}
          >
            {translate('acceptance.group.feedbackSubmit')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

GroupFeedbackContent.displayName = 'AcceptanceGroupFeedbackContent';

/**
 * Group-scoped feedback dialog — the channel for concerns that belong to no
 * single check (which may well be accepted) yet must reach the next round.
 */
export const openGroupFeedbackModal = (
  options: GroupFeedbackContentProps & { title?: string },
): ModalInstance =>
  createModal({
    content: <GroupFeedbackContent {...options} />,
    footer: null,
    maskClosable: true,
    styles: frostedModalStyles,
    title: options.title ?? t('acceptance.group.feedbackTitle', { ns: 'verify' }),
    width: 'min(90vw, 520px)',
  });
