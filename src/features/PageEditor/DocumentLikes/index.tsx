'use client';

import type { DocumentLikeSummary } from '@lobechat/types';
import { Flexbox, Skeleton, Text, toast, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ThumbsUp } from 'lucide-react';
import { memo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AsyncError from '@/components/AsyncError';
import UserAvatar from '@/components/UserAvatar';
import { useClientDataSWR } from '@/libs/swr';
import { documentLikeKeys } from '@/libs/swr/keys';
import { documentLikeService } from '@/services/documentLike';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { resolveDocumentSectionState } from '../isDocumentUnavailableError';

const BUTTON_SIZE = 56;
const ICON_SIZE = 22;

const styles = stylex.create({
  // ~15 avatars per row: 15 × (32px avatar + 8px gap)
  avatars: {
    flexWrap: 'wrap',
    justifyContent: 'center',
    maxWidth: '600px',
    minHeight: '32px',
  },
  button: {
    cursor: { 'default': 'pointer', ':disabled': 'progress' },
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: `${BUTTON_SIZE}px`,
    height: `${BUTTON_SIZE}px`,
    padding: 0,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorPrimary,
    borderRadius: '50%',
    color: cssVar.colorPrimary,
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorPrimaryBg },
    backgroundImage: 'none',
    opacity: { 'default': null, ':disabled': 0.7 },
    transform: { 'default': null, ':hover': 'scale(1.06)', ':active': 'scale(0.94)' },
    transition: `transform ${cssVar.motionDurationMid} ${cssVar.motionEaseOutBack}, background-color ${cssVar.motionDurationMid}, border-color ${cssVar.motionDurationMid}, color ${cssVar.motionDurationMid}, box-shadow ${cssVar.motionDurationMid}`,
    outlineStyle: { 'default': null, ':focus-visible': 'none' },
    boxShadow: { 'default': null, ':focus-visible': `0 0 0 3px ${cssVar.colorPrimaryBg}` },
  },
  buttonPressed: {
    borderColor: cssVar.colorWarning,
    color: cssVar.colorWhite,
    backgroundColor: { 'default': cssVar.colorWarning, ':hover': cssVar.colorWarningHover },
    boxShadow: {
      'default': `0 8px 24px ${cssVar.colorWarningBg}`,
      ':focus-visible': `0 0 0 3px ${cssVar.colorWarningBg}`,
    },
  },
  caption: {
    'display': 'flex',
    'gap': '16px',
    'alignItems': 'center',
    'color': cssVar.colorTextTertiary,
    'whiteSpace': 'nowrap',
    '::before': {
      content: '""',
      width: '40px',
      height: '1px',
      backgroundColor: cssVar.colorBorderSecondary,
      backgroundImage: 'none',
    },
    '::after': {
      content: '""',
      width: '40px',
      height: '1px',
      backgroundColor: cssVar.colorBorderSecondary,
      backgroundImage: 'none',
    },
  },
  section: { width: '100%', marginBlockStart: '48px' },
});

const useDocumentLikeSummary = (workspaceId: string | null, documentId?: string | null) =>
  useClientDataSWR<DocumentLikeSummary>(
    workspaceId && documentId ? documentLikeKeys.summary(workspaceId, documentId) : null,
    () => documentLikeService.summary(documentId!),
    { dedupingInterval: 30_000 },
  );

const DocumentLikes = memo<{ documentId: string }>(({ documentId }) => {
  const { t } = useTranslation('file');
  const workspaceId = useActiveWorkspaceId();
  const user = useUserStore(userProfileSelectors.userProfile);
  const { data, error, isLoading, mutate } = useDocumentLikeSummary(workspaceId, documentId);
  // Last user-intended liked state; null when the UI matches the server.
  const targetRef = useRef<boolean | null>(null);
  const inFlightRef = useRef(false);

  // Send requests until the server state matches the latest intent. Clicks
  // landing while a request is in flight only update targetRef (the UI already
  // flipped optimistically), so every click responds instantly and a rapid
  // like→unlike coalesces into sequential calls instead of being dropped.
  const drain = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    let sent: boolean | undefined;
    try {
      let summary: DocumentLikeSummary | undefined;
      while (targetRef.current !== null && targetRef.current !== sent) {
        sent = targetRef.current;
        summary = sent
          ? await documentLikeService.like(documentId)
          : await documentLikeService.unlike(documentId);
      }
      targetRef.current = null;
      if (summary) await mutate(summary, { revalidate: false });
    } catch (toggleError) {
      console.error('Failed to toggle document like', toggleError);
      targetRef.current = null;
      toast.error(t('pageEditor.likes.failed'));
      // Recover the truth from the server rather than guessing a rollback
      // point across coalesced toggles. The recovery fetch itself can fail
      // (e.g. an outage) — swallow it so drain() never rejects out of a void
      // call; SWR revalidates again on the next focus/interval and corrects
      // any stale optimistic state then.
      await mutate().catch(() => undefined);
    } finally {
      inFlightRef.current = false;
    }
  }, [documentId, mutate, t]);

  const toggle = useCallback(() => {
    if (!data) return;

    const nextLiked = !(targetRef.current ?? data.liked);
    targetRef.current = nextLiked;

    void mutate(
      (previous) => {
        if (!previous) return previous;
        return nextLiked
          ? {
              liked: true,
              likers: [
                {
                  avatar: user?.avatar ?? null,
                  fullName: user?.fullName ?? null,
                  id: user?.id ?? 'me',
                  username: user?.username ?? null,
                },
                ...previous.likers.filter((liker) => liker.id !== (user?.id ?? 'me')),
              ],
              total: previous.total + 1,
            }
          : {
              liked: false,
              likers: previous.likers.filter((liker) => liker.id !== (user?.id ?? 'me')),
              total: Math.max(0, previous.total - 1),
            };
      },
      { revalidate: false },
    );
    void drain();
  }, [data, drain, mutate, user?.avatar, user?.fullName, user?.id, user?.username]);

  if (!workspaceId) return null;

  // A page that went private or is gone drops even the cached count and likers;
  // a failed initial load must not masquerade as a zero-like page, so it
  // surfaces a retryable error instead of the idle state with a dead button.
  const sectionState = resolveDocumentSectionState(data, error);
  if (sectionState === 'hidden') return null;
  if (sectionState === 'error')
    return (
      <Flexbox
        data-document-likes
        align={'center'}
        className={stylex.props(styles.section).className}
        gap={16}
      >
        <AsyncError error={error} variant={'inline'} onRetry={() => void mutate()} />
      </Flexbox>
    );

  // Match the surrounding page skeleton while the summary loads instead of
  // flashing the finished idle state ahead of the rest of the content.
  if (isLoading && !data)
    return (
      <Flexbox
        data-document-likes
        align={'center'}
        className={stylex.props(styles.section).className}
        gap={16}
      >
        <Skeleton.Avatar shape={'circle'} size={BUTTON_SIZE} />
        <Skeleton height={20} width={200} />
      </Flexbox>
    );

  const liked = data?.liked ?? false;
  const likers = data?.likers ?? [];
  const total = data?.total ?? 0;
  const overflow = Math.max(0, total - likers.length);
  // The filled button already says "you liked this"; the caption only carries
  // the count (or the invite copy while nobody has liked yet).
  const label =
    total > 0 ? t('pageEditor.likes.count', { count: total }) : t('pageEditor.likes.like');
  const ariaLabel = liked ? t('pageEditor.likes.liked') : t('pageEditor.likes.like');

  return (
    <Flexbox
      data-document-likes
      align={'center'}
      className={stylex.props(styles.section).className}
      gap={16}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        aria-label={ariaLabel}
        aria-pressed={liked}
        {...stylex.props(styles.button, liked && styles.buttonPressed)}
        disabled={isLoading || !data}
        type={'button'}
        onClick={() => void toggle()}
      >
        <ThumbsUp
          fill={liked ? 'currentColor' : 'none'}
          size={ICON_SIZE}
          strokeWidth={liked ? 0 : 1.5}
        />
      </button>
      <span {...stylex.props(styles.caption)}>
        <Text as={'span'} color={'inherit'} fontSize={13}>
          {label}
        </Text>
      </span>
      {(likers.length > 0 || overflow > 0) && (
        <Flexbox horizontal className={stylex.props(styles.avatars).className} gap={8}>
          {likers.map((liker) => {
            const name = liker.fullName || liker.username || liker.id;
            return (
              <Tooltip key={liker.id} title={name}>
                <UserAvatar avatar={liker.avatar} name={name} size={32} />
              </Tooltip>
            );
          })}
          {overflow > 0 && (
            <Text fontSize={13} type={'secondary'}>
              {t('pageEditor.likes.more', { count: overflow })}
            </Text>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
});

DocumentLikes.displayName = 'DocumentLikes';

export default DocumentLikes;
