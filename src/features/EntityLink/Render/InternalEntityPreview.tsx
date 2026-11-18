'use client';

import {
  ActionIcon,
  Avatar,
  createStaticStyles,
  Flexbox,
  Freeze,
  Icon,
  Popover,
  Text,
} from '@lobehub/ui';
import type { TFunction } from 'i18next';
import {
  BadgeCheckIcon,
  BotIcon,
  CheckCircleIcon,
  CheckSquareIcon,
  ExternalLink,
  FileTextIcon,
  TargetIcon,
} from 'lucide-react';
import { memo, type PropsWithChildren, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ArticleSkeleton } from '@/components/Skeleton';
import { goalStatusKey } from '@/features/AgentGoals/goalPresentation';
import type { EntityPreview } from '@/store/entityPreview';
import { openTrustedExternalUrl } from '@/utils/openTrustedExternalUrl';

import type { InternalLinkReference } from '../internalLink';
import { useAcceptanceBrowserUrl } from './useAcceptanceBrowserUrl';
import { useEntityPreview } from './useEntityPreview';

const styles = createStaticStyles(({ css, cssVar }) => ({
  content: css`
    width: 320px;
    padding: 16px;
  `,
  description: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;

    line-height: 1.55;
    color: ${cssVar.colorTextSecondary};
  `,
  icon: css`
    display: grid;
    flex: none;
    place-items: center;

    width: 36px;
    height: 36px;
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  title: css`
    overflow: hidden;

    font-weight: 600;
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  type: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

const getVerifyStatusLabel = (status: string | null | undefined, t: TFunction<'chat'>) => {
  switch (status) {
    case 'delivered': {
      return t('internalLink.preview.verifyStatus.delivered');
    }
    case 'errored': {
      return t('internalLink.preview.verifyStatus.errored');
    }
    case 'failed': {
      return t('internalLink.preview.verifyStatus.failed');
    }
    case 'passed': {
      return t('internalLink.preview.verifyStatus.passed');
    }
    case 'planned': {
      return t('internalLink.preview.verifyStatus.planned');
    }
    case 'repairing': {
      return t('internalLink.preview.verifyStatus.repairing');
    }
    case 'uncertain': {
      return t('internalLink.preview.verifyStatus.uncertain');
    }
    case 'unverified': {
      return t('internalLink.preview.verifyStatus.unverified');
    }
    case 'verifying': {
      return t('internalLink.preview.verifyStatus.verifying');
    }
    default: {
      return null;
    }
  }
};

/**
 * The card's status lines. They come from statuses and counts that move on
 * while the entity runs, so a preview restored from an earlier session only
 * shows them once the server has confirmed it; the branch / commit / tested-at
 * line of a verify run is fixed and paints at once.
 */
export const formatPreviewMeta = (
  preview: EntityPreview | undefined,
  isConfirmed: boolean,
  t: TFunction<'chat'>,
): { meta?: string | null; secondaryMeta?: string | null } => {
  if (!preview) return {};

  const { acceptance, goal, verify } = preview;
  const verifyScope = verify
    ? [
        verify.branch,
        verify.commit,
        verify.testedAt ? new Date(verify.testedAt).toLocaleString() : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  if (!isConfirmed) return { secondaryMeta: verifyScope };

  if (acceptance)
    return {
      meta: t('internalLink.preview.acceptanceCounts', {
        exceptions: acceptance.exceptions,
        passed: acceptance.passed,
        total: acceptance.total,
      }),
      secondaryMeta: t('internalLink.preview.acceptanceRounds', { count: acceptance.rounds }),
    };

  if (goal)
    return {
      meta: [
        goal.pendingDecisions > 0
          ? t('goalList.needsYou', { count: goal.pendingDecisions })
          : t(goalStatusKey(goal.status)),
        t('goalList.taskProgress', { done: goal.done, total: goal.total }),
      ].join(' · '),
    };

  if (verify)
    return {
      meta: [
        getVerifyStatusLabel(verify.status, t),
        verify.counts ? t('internalLink.preview.verifyCounts', verify.counts) : null,
      ]
        .filter(Boolean)
        .join(' · '),
      secondaryMeta: verifyScope,
    };

  return {};
};

interface InternalEntityPreviewProps extends PropsWithChildren {
  fallbackTitle: string;
  reference: Exclude<InternalLinkReference, { type: 'route' }>;
}

export const InternalEntityPreview = memo<InternalEntityPreviewProps>(
  ({ children, fallbackTitle, reference }) => {
    const { t } = useTranslation('chat');
    const { t: tVerify } = useTranslation('verify');
    const [open, setOpen] = useState(false);
    // A click on the link opens the acceptance in the side panel; this is the
    // explicit way out to a full browser page.
    const browserUrl = useAcceptanceBrowserUrl(reference);
    const {
      error,
      isConfirmed,
      isHydrated,
      isValidating,
      preview: data,
      title,
    } = useEntityPreview(reference, open);
    // Skeleton only while nothing at all is known; a remembered preview paints
    // at once and the network confirms it behind it.
    const isLoading = !data && !error && (!isHydrated || isValidating);
    const { meta, secondaryMeta } = formatPreviewMeta(data, isConfirmed, t);

    const icon =
      reference.type === 'acceptance'
        ? BadgeCheckIcon
        : reference.type === 'agent'
          ? BotIcon
          : reference.type === 'goal'
            ? TargetIcon
            : reference.type === 'task'
              ? CheckSquareIcon
              : reference.type === 'verify'
                ? CheckCircleIcon
                : FileTextIcon;
    const typeLabel = t(`internalLink.preview.${reference.type}`);

    const content = isLoading ? (
      <div className={styles.content}>
        <ArticleSkeleton avatar rows={2} />
      </div>
    ) : (
      <Flexbox className={styles.content} gap={12}>
        <Flexbox horizontal align="center" gap={12}>
          {reference.type === 'agent' && data?.avatar ? (
            <Avatar
              avatar={data.avatar}
              background={data.backgroundColor ?? undefined}
              shape="square"
              size={36}
            />
          ) : (
            <span className={styles.icon}>
              <Icon icon={icon} size={19} />
            </span>
          )}
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <span className={styles.type}>{typeLabel}</span>
            <span className={styles.title}>{title || fallbackTitle}</span>
          </Flexbox>
          {browserUrl && (
            <ActionIcon
              icon={ExternalLink}
              size={'small'}
              title={tVerify('report.actions.openInBrowser')}
              onClick={() => openTrustedExternalUrl(browserUrl)}
            />
          )}
        </Flexbox>
        {data?.description && (
          <Text className={styles.description} fontSize={13}>
            {data.description}
          </Text>
        )}
        {meta && (
          <Text fontSize={12} type={'secondary'}>
            {meta}
          </Text>
        )}
        {secondaryMeta && (
          <Text fontSize={12} type={'secondary'}>
            {secondaryMeta}
          </Text>
        )}
      </Flexbox>
    );

    return (
      <Popover
        // Keep the closing card as it was through the exit animation.
        content={<Freeze frozen={!open}>{content}</Freeze>}
        mouseEnterDelay={0.35}
        open={open}
        placement="top"
        styles={{ content: { borderRadius: 12, overflow: 'hidden', padding: 0 } }}
        trigger="hover"
        triggerProps={{ role: 'link' }}
        onOpenChange={setOpen}
      >
        {children}
      </Popover>
    );
  },
);

InternalEntityPreview.displayName = 'InternalEntityPreview';
