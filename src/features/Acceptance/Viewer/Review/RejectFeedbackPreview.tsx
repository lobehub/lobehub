'use client';

import { Avatar, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, ChevronUp, CircleAlert, Loader2, MessagesSquare } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { useAcceptanceComments } from '../Comments/hooks';
import { AttachmentThumbs } from '../Evidence/attachments';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import {
  collectRejectFeedback,
  type RejectFeedbackItem,
  rejectFeedbackPreviewState,
} from './rejectFeedback';

const styles = stylex.create({
  avatarStack: {
    flex: 'none',
  },
  // Every avatar after the first tucks under its neighbour (the old `> * + *`).
  avatarOverlap: {
    marginInlineStart: '-6px',
    boxShadow: `0 0 0 2px ${cssVar.colorBgElevated}`,
  },
  box: {
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
  },
  body: {
    paddingBlockStart: 0,
    paddingBlockEnd: '10px',
    paddingInline: '12px',
  },
  list: {
    overflowY: 'auto',
    maxHeight: '240px',
  },
  row: {
    paddingBlock: '10px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: { 'default': 'solid', ':last-child': 'none' },
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  summary: {
    paddingBlock: '10px',
    paddingInline: '12px',
  },
  toggle: {
    cursor: 'pointer',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
  },
});

const useAuthorLabel = () => {
  const { t } = useTranslation('verify');
  return (author: RejectFeedbackItem['author']) =>
    author.kind === 'unknown'
      ? t('acceptance.reject.unattributed')
      : author.name || t('acceptance.reject.teammate');
};

const AuthorAvatar = memo<{
  author: RejectFeedbackItem['author'];
  label: string;
  overlap?: boolean;
}>(({ author, label, overlap }) =>
  author.kind === 'unknown' ? (
    <Avatar
      avatar={<Icon icon={MessagesSquare} size={12} />}
      size={20}
      {...stylex.props(overlap && styles.avatarOverlap)}
    />
  ) : (
    // First character only — a two-character CJK name wraps in a small circle.
    <Avatar
      avatar={author.avatar || label.slice(0, 1)}
      size={20}
      {...stylex.props(overlap && styles.avatarOverlap)}
    />
  ),
);

AuthorAvatar.displayName = 'AcceptanceRejectAuthorAvatar';

const FeedbackRow = memo<{ item: RejectFeedbackItem }>(({ item }) => {
  const { t } = useTranslation('verify');
  const authorLabel = useAuthorLabel()(item.author);
  const metaBits = [
    item.scope,
    item.annotationCount
      ? t('acceptance.feedback.annotations', { count: item.annotationCount })
      : null,
  ].filter(Boolean);

  return (
    <Flexbox horizontal gap={8} {...stylex.props(styles.row)}>
      <AuthorAvatar author={item.author} label={authorLabel} />
      <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
        <Flexbox horizontal align={'baseline'} gap={6} style={{ minWidth: 0 }}>
          <Text strong fontSize={12} style={{ flex: 'none' }}>
            {authorLabel}
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

FeedbackRow.displayName = 'AcceptanceRejectFeedbackRow';

const Notice = memo<{ icon: typeof MessagesSquare; spin?: boolean; text: string }>(
  ({ icon, spin, text }) => (
    <Flexbox horizontal align={'center'} gap={8} {...stylex.props(styles.box, styles.summary)}>
      <Icon color={cssVar.colorTextTertiary} icon={icon} size={16} spin={spin} />
      <Text fontSize={13} type={'secondary'}>
        {text}
      </Text>
    </Flexbox>
  ),
);

Notice.displayName = 'AcceptanceRejectFeedbackNotice';

/**
 * What the repair prompt carries besides the reason, read live — the dialog
 * may open before the discussion has loaded, and a snapshot taken then would
 * promise "nothing else goes along" while the agent still reads every comment.
 */
const RejectFeedbackPreview = memo<{ acceptanceId: string }>(({ acceptanceId }) => {
  const { t } = useTranslation('verify');
  const [open, setOpen] = useState(false);
  const { data: bundle } = useAcceptanceBundle(acceptanceId, { poll: false });
  const { error, isLoading, items: comments } = useAcceptanceComments(acceptanceId);
  const viewerId = useUserStore(userProfileSelectors.userId);
  const viewerName = useUserStore(userProfileSelectors.displayUserName);
  const viewerAvatar = useUserStore(userProfileSelectors.userAvatar);
  const authorLabel = useAuthorLabel();

  const feedback = useMemo(
    () =>
      bundle
        ? collectRejectFeedback({
            bundle,
            comments,
            viewer: { avatar: viewerAvatar, id: viewerId, name: viewerName },
          })
        : [],
    [bundle, comments, viewerAvatar, viewerId, viewerName],
  );

  const state = rejectFeedbackPreviewState({
    bundleReady: Boolean(bundle),
    commentsError: error,
    commentsLoading: isLoading,
    count: feedback.length,
  });
  if (state === 'loading')
    return <Notice spin icon={Loader2} text={t('acceptance.reject.includedLoading')} />;
  if (state === 'error')
    return <Notice icon={CircleAlert} text={t('acceptance.reject.includedError')} />;
  if (state === 'none')
    return <Notice icon={MessagesSquare} text={t('acceptance.reject.includedNone')} />;

  const counts = { mine: 0, other: 0, unknown: 0 };
  for (const item of feedback) counts[item.author.kind] += 1;
  const breakdown = [
    counts.mine > 0 && t('acceptance.reject.includedMine', { count: counts.mine }),
    counts.other > 0 && t('acceptance.reject.includedOthers', { count: counts.other }),
    counts.unknown > 0 && t('acceptance.reject.includedUnattributed', { count: counts.unknown }),
  ].filter(Boolean);
  // Distinct faces behind the queued feedback, for the summary bar.
  const faces = [
    ...new Map(
      feedback
        .filter((item) => item.author.kind !== 'unknown')
        .map((item) => [authorLabel(item.author), item.author]),
    ).entries(),
  ].slice(0, 3);
  const toggle = () => setOpen((value) => !value);

  return (
    <Flexbox {...stylex.props(styles.box)}>
      <Flexbox
        horizontal
        align={'center'}
        aria-expanded={open}
        gap={8}
        role={'button'}
        tabIndex={0}
        {...stylex.props(styles.summary, styles.toggle)}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggle();
          }
        }}
      >
        <Icon icon={MessagesSquare} size={16} />
        <Text strong fontSize={13} style={{ flex: 1, minWidth: 0 }}>
          {[t('acceptance.reject.included', { count: feedback.length }), ...breakdown].join(' · ')}
        </Text>
        <Flexbox horizontal {...stylex.props(styles.avatarStack)}>
          {faces.map(([label, author], index) => (
            <AuthorAvatar author={author} key={label} label={label} overlap={index > 0} />
          ))}
        </Flexbox>
        <Icon icon={open ? ChevronUp : ChevronDown} size={14} />
      </Flexbox>
      {open && (
        <Flexbox gap={4} {...stylex.props(styles.body)}>
          <Text fontSize={12} type={'secondary'}>
            {t('acceptance.reject.includedHint')}
          </Text>
          <Flexbox {...stylex.props(styles.list)}>
            {feedback.map((item) => (
              <FeedbackRow item={item} key={item.key} />
            ))}
          </Flexbox>
        </Flexbox>
      )}
    </Flexbox>
  );
});

RejectFeedbackPreview.displayName = 'AcceptanceRejectFeedbackPreview';

export default RejectFeedbackPreview;
