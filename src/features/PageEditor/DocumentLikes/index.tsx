'use client';

import type { DocumentLikeSummary } from '@lobechat/types';
import { useAnalytics } from '@lobehub/analytics/react';
import { Flexbox, Skeleton } from '@lobehub/ui';
import { Avatar, Text, toast, Tooltip } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ThumbsUp } from 'lucide-react';
import { memo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AsyncError from '@/components/AsyncError';
import { useClientDataSWR } from '@/libs/swr';
import { documentLikeKeys } from '@/libs/swr/keys';
import { documentLikeService } from '@/services/documentLike';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

const BUTTON_SIZE = 56;
const ICON_SIZE = 22;

const styles = createStaticStyles(({ css }) => ({
  avatars: css`
    flex-wrap: wrap;
    justify-content: center;

    /* ~15 avatars per row: 15 × (32px avatar + 8px gap) */
    max-width: 600px;
    min-height: 32px;
  `,
  button: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    width: ${BUTTON_SIZE}px;
    height: ${BUTTON_SIZE}px;
    padding: 0;
    border: 1px solid ${cssVar.colorPrimary};
    border-radius: 50%;

    color: ${cssVar.colorPrimary};

    background: transparent;

    transition:
      transform ${cssVar.motionDurationMid} ${cssVar.motionEaseOutBack},
      background-color ${cssVar.motionDurationMid},
      border-color ${cssVar.motionDurationMid},
      color ${cssVar.motionDurationMid},
      box-shadow ${cssVar.motionDurationMid};

    &:hover {
      transform: scale(1.06);
      background: ${cssVar.colorPrimaryBg};
    }

    &:active {
      transform: scale(0.94);
    }

    &:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px ${cssVar.colorPrimaryBg};
    }

    &[aria-pressed='true'] {
      border-color: ${cssVar.colorWarning};
      color: ${cssVar.colorWhite};
      background: ${cssVar.colorWarning};
      box-shadow: 0 8px 24px ${cssVar.colorWarningBg};

      &:hover {
        background: ${cssVar.colorWarningHover};
      }

      &:focus-visible {
        box-shadow: 0 0 0 3px ${cssVar.colorWarningBg};
      }
    }

    &:disabled {
      cursor: progress;
      opacity: 0.7;
    }
  `,
  caption: css`
    display: flex;
    gap: 16px;
    align-items: center;

    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;

    &::before,
    &::after {
      content: '';
      width: 40px;
      height: 1px;
      background: ${cssVar.colorBorderSecondary};
    }
  `,
  section: css`
    width: 100%;
    margin-block-start: 48px;
  `,
}));

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
  const { analytics } = useAnalytics();
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
        // Bounded dimensions only — no document id, which would create an
        // unbounded high-cardinality analytics field.
        analytics?.track({
          name: 'document_like_toggle',
          properties: {
            action: sent ? 'like' : 'unlike',
            outcome: 'success',
            spm: 'page_editor.likes.toggle',
          },
        });
      }
      targetRef.current = null;
      if (summary) await mutate(summary, { revalidate: false });
    } catch (toggleError) {
      console.error('Failed to toggle document like', toggleError);
      // Attribute the failure to the request that actually failed (`sent`),
      // not the latest queued intent, which may already point the other way.
      if (sent !== undefined)
        analytics?.track({
          name: 'document_like_toggle',
          properties: {
            action: sent ? 'like' : 'unlike',
            outcome: 'failure',
            spm: 'page_editor.likes.toggle',
          },
        });
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
  }, [analytics, documentId, mutate, t]);

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

  // A failed initial load must not masquerade as a zero-like page: surface a
  // retryable error instead of the idle state with a dead button.
  if (!data && error)
    return (
      <Flexbox data-document-likes align={'center'} className={styles.section} gap={16}>
        <AsyncError error={error} variant={'inline'} onRetry={() => void mutate()} />
      </Flexbox>
    );

  // Match the surrounding page skeleton while the summary loads instead of
  // flashing the finished idle state ahead of the rest of the content.
  if (isLoading && !data)
    return (
      <Flexbox data-document-likes align={'center'} className={styles.section} gap={16}>
        <Skeleton.Avatar active shape={'circle'} size={BUTTON_SIZE} />
        <Skeleton.Button active style={{ height: 20, width: 200 }} />
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
      className={styles.section}
      gap={16}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        aria-label={ariaLabel}
        aria-pressed={liked}
        className={styles.button}
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
      <span className={styles.caption}>
        <Text as={'span'} color={'inherit'} fontSize={13}>
          {label}
        </Text>
      </span>
      {(likers.length > 0 || overflow > 0) && (
        <Flexbox horizontal className={styles.avatars} gap={8}>
          {likers.map((liker) => {
            const name = liker.fullName || liker.username || liker.id;
            return (
              <Tooltip key={liker.id} title={name}>
                <Avatar avatar={liker.avatar || name} size={32} />
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
