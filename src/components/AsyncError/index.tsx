'use client';

import { Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { RotateCwIcon, TriangleAlertIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { normalizeAsyncError } from '@/libs/swr/normalizeError';

/**
 * The error counterpart to the loading family (`NeuralNetworkLoading`,
 * `SkeletonLoading`, …). One reusable component, several `variant`s so different
 * surfaces express failure differently without each re-implementing the
 * icon + reason + retry plumbing. Pick the variant by where the failure lives;
 * the judgment (status → copy, retryable → show/hide Retry) stays here.
 *
 * - `page`   — full detail page / whole surface: centered hero + Reload.
 * - `block`  — a card / settings tab / widget: bordered block + Reload.
 * - `inline` — a list row / small slot: single line + retry link.
 * - `metric` — a stat / aggregate slot: a **failed** marker where a number
 *              would sit, so an errored fetch never reads as a confident `$0`.
 */
export type AsyncErrorVariant = 'page' | 'block' | 'inline' | 'metric';

export interface AsyncErrorProps {
  /** Override the auto-derived description (status-based copy otherwise). */
  description?: ReactNode;
  /** The thrown error; normalized for status-specific copy + retryable gating. */
  error?: unknown;
  /** Retry the same request (SWR `mutate` / query refetch). Hidden if absent. */
  onRetry?: () => void;
  /** Override the default title copy. */
  title?: ReactNode;
  variant?: AsyncErrorVariant;
}

const styles = createStaticStyles(({ css }) => ({
  block: css`
    width: 100%;
    min-height: 180px;
    padding: 32px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  icon: css`
    color: ${cssVar.colorTextTertiary};
  `,
  inline: css`
    padding-block: 8px;
  `,
  metric: css`
    color: ${cssVar.colorTextQuaternary};
  `,
  page: css`
    flex: 1;
    width: 100%;
    min-height: 320px;
    padding: 48px;
  `,
}));

const AsyncError = memo<AsyncErrorProps>(
  ({ variant = 'block', error, onRetry, title, description }) => {
    const { t } = useTranslation('error');
    const { status, retryable } = normalizeAsyncError(error);

    // Status-specific copy when we recovered a status, else the generic reason.
    const reason =
      description ??
      (status ? t(`response.${status}` as any, t('asyncState.desc')) : t('asyncState.desc'));
    const heading = title ?? t('asyncState.title');
    const showRetry = !!onRetry && retryable;

    // ─── metric: a failed marker where a number would render (never a fake $0) ───
    if (variant === 'metric') {
      return (
        <Flexbox horizontal align={'center'} className={styles.metric} gap={6}>
          <Icon icon={TriangleAlertIcon} size={14} />
          <Text color={cssVar.colorTextQuaternary} fontSize={13}>
            {t('asyncState.metricLabel')}
          </Text>
          {showRetry && (
            <Text
              aria-label={t('error.retry')}
              role={'button'}
              style={{ color: cssVar.colorPrimary, cursor: 'pointer' }}
              tabIndex={0}
              onClick={onRetry}
            >
              {t('error.retry')}
            </Text>
          )}
        </Flexbox>
      );
    }

    // ─── inline: single-line row failure with a retry link ───
    if (variant === 'inline') {
      return (
        <Flexbox horizontal align={'center'} className={styles.inline} gap={8} justify={'center'}>
          <Icon className={styles.icon} icon={TriangleAlertIcon} size={14} />
          <Text color={cssVar.colorTextSecondary} fontSize={13}>
            {heading}
          </Text>
          {showRetry && (
            <Text
              role={'button'}
              style={{ color: cssVar.colorPrimary, cursor: 'pointer' }}
              tabIndex={0}
              onClick={onRetry}
            >
              {t('error.retry')}
            </Text>
          )}
        </Flexbox>
      );
    }

    // ─── page / block: centered hero, sized by variant ───
    return (
      <Center className={variant === 'page' ? styles.page : styles.block} gap={12}>
        <Icon
          className={styles.icon}
          icon={TriangleAlertIcon}
          size={variant === 'page' ? 32 : 24}
        />
        <Flexbox align={'center'} gap={4}>
          <Text fontSize={variant === 'page' ? 16 : 15} weight={600}>
            {heading}
          </Text>
          <Text
            align={'center'}
            color={cssVar.colorTextTertiary}
            fontSize={13}
            style={{ maxWidth: 360 }}
          >
            {reason}
          </Text>
        </Flexbox>
        {showRetry && (
          <Button icon={<Icon icon={RotateCwIcon} />} size={'small'} onClick={onRetry}>
            {t('error.retry')}
          </Button>
        )}
      </Center>
    );
  },
);

AsyncError.displayName = 'AsyncError';

export default AsyncError;
