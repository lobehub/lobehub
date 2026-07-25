'use client';

import type {
  CodexQuotaSnapshot,
  CodexQuotaWindow,
  CodexRateLimitResetCredit,
  CodexRateLimitSnapshot,
} from '@lobechat/electron-client-ipc';
import { uuid } from '@lobechat/utils';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Button, confirmModal, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { RotateCcwIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { heterogeneousAgentService } from '@/services/electron/heterogeneousAgent';

import type { FetchQuotaOptions, QuotaMenuHelpers, QuotaWindowItem } from './QuotaMenu';
import QuotaMenu, { createQuotaSourceKey } from './QuotaMenu';

const FIVE_HOUR_WINDOW_MINUTES = 5 * 60;
const WEEKLY_WINDOW_MINUTES = 7 * 24 * 60;
const MONTHLY_WINDOW_MIN_MINUTES = 28 * 24 * 60;
const MONTHLY_WINDOW_MAX_MINUTES = 31 * 24 * 60;

const styles = createStaticStyles(({ css }) => ({
  credit: css`
    min-width: 0;
    padding-block: 8px;
    padding-inline: 10px;

    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  creditExpiry: css`
    flex: none;
    text-align: end;
    white-space: nowrap;
  `,
  creditIndex: css`
    flex: 0 0 20px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  creditList: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorFillQuaternary};
  `,
  creditTitle: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  feedback: css`
    padding: 8px;
    border: 1px solid ${cssVar.colorInfoBorder};
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorInfoText};

    background: ${cssVar.colorInfoBg};

    &[data-kind='error'] {
      border-color: ${cssVar.colorErrorBorder};
      color: ${cssVar.colorErrorText};
      background: ${cssVar.colorErrorBg};
    }

    &[data-kind='success'] {
      border-color: ${cssVar.colorSuccessBorder};
      color: ${cssVar.colorSuccessText};
      background: ${cssVar.colorSuccessBg};
    }
  `,
  resetCredits: css`
    padding-block-start: 8px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

const createErrorSnapshot = (error: unknown): CodexQuotaSnapshot => ({
  error: error instanceof Error ? error.message : String(error),
  provider: 'codex',
  rateLimitResetCredits: null,
  session: null,
  status: 'error',
  updatedAt: Date.now(),
  weekly: null,
});

const getAvailableResetCredits = (credits: CodexRateLimitResetCredit[] | undefined, now: number) =>
  [...(credits ?? [])]
    .filter(
      (credit) =>
        credit.status === 'available' && (credit.expiresAt === null || credit.expiresAt > now),
    )
    .sort((left, right) => {
      const expiryDifference =
        (left.expiresAt ?? Number.POSITIVE_INFINITY) -
        (right.expiresAt ?? Number.POSITIVE_INFINITY);
      if (expiryDifference !== 0) return expiryDifference;
      return (left.id ?? '').localeCompare(right.id ?? '');
    });

interface CodexQuotaMenuProps {
  command?: string;
  env?: Record<string, string>;
}

interface ResetAttempt {
  creditId?: string;
  idempotencyKey: string;
}

interface ResetFeedback {
  kind: 'error' | 'info' | 'success';
  text: string;
}

const CodexQuotaMenu = memo<CodexQuotaMenuProps>(({ command, env }) => {
  const { t } = useTranslation('chat');
  const sourceKey = createQuotaSourceKey('codex', command, env);
  const activeSourceKeyRef = useRef(sourceKey);
  const resetAttemptRef = useRef<ResetAttempt | null>(null);
  const [resetFeedback, setResetFeedback] = useState<ResetFeedback>();
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    activeSourceKeyRef.current = sourceKey;
    resetAttemptRef.current = null;
    setResetFeedback(undefined);
    setResetting(false);
  }, [sourceKey]);

  const fetchQuota = useCallback(
    (options?: FetchQuotaOptions) =>
      heterogeneousAgentService.getCodexQuota({
        command,
        env,
        ...(options?.force ? { force: true } : {}),
      }),
    [command, env],
  );

  const getWindowLabel = useCallback(
    (window: CodexQuotaWindow | null, fallback: string) => {
      if (!window) return fallback;
      if (window.windowMinutes === FIVE_HOUR_WINDOW_MINUTES) {
        return t('heteroAgent.codexQuota.fiveHour');
      }
      if (window.windowMinutes === WEEKLY_WINDOW_MINUTES) {
        return t('heteroAgent.quota.weekly');
      }
      if (
        window.windowMinutes >= MONTHLY_WINDOW_MIN_MINUTES &&
        window.windowMinutes <= MONTHLY_WINDOW_MAX_MINUTES
      ) {
        return t('heteroAgent.codexQuota.monthly');
      }
      return fallback;
    },
    [t],
  );

  const getRateLimitWindowLabel = useCallback(
    (rateLimit: CodexRateLimitSnapshot, window: CodexQuotaWindow, fallback: string) => {
      const windowLabel = getWindowLabel(window, fallback);
      if (rateLimit.limitId.toLowerCase() === 'codex') return windowLabel;

      return `${rateLimit.limitName || rateLimit.limitId} · ${windowLabel}`;
    },
    [getWindowLabel],
  );

  const getWindows = useCallback(
    (quota: CodexQuotaSnapshot): QuotaWindowItem[] => {
      if (!quota.rateLimits?.length) {
        return [
          {
            key: 'primary',
            label: getWindowLabel(quota.session, t('heteroAgent.quota.session')),
            window: quota.session,
          },
          {
            key: 'secondary',
            label: getWindowLabel(quota.weekly, t('heteroAgent.quota.weekly')),
            window: quota.weekly,
          },
        ];
      }

      return quota.rateLimits.flatMap((rateLimit) => {
        const windows: QuotaWindowItem[] = [];

        if (rateLimit.primary) {
          windows.push({
            key: `${rateLimit.limitId}:primary`,
            label: getRateLimitWindowLabel(
              rateLimit,
              rateLimit.primary,
              t('heteroAgent.quota.session'),
            ),
            window: rateLimit.primary,
          });
        }

        if (rateLimit.secondary) {
          windows.push({
            key: `${rateLimit.limitId}:secondary`,
            label: getRateLimitWindowLabel(
              rateLimit,
              rateLimit.secondary,
              t('heteroAgent.quota.weekly'),
            ),
            window: rateLimit.secondary,
          });
        }

        return windows;
      });
    },
    [getRateLimitWindowLabel, getWindowLabel, t],
  );

  const hasExtraData = useCallback(
    (quota: CodexQuotaSnapshot) => !!quota.rateLimitResetCredits,
    [],
  );

  const consumeReset = useCallback(
    async (
      creditId: string | undefined,
      applyQuota: (quota: CodexQuotaSnapshot) => void,
      requestSourceKey: string,
    ) => {
      const previousAttempt = resetAttemptRef.current;
      const attempt =
        previousAttempt && previousAttempt.creditId === creditId
          ? previousAttempt
          : {
              ...(creditId ? { creditId } : {}),
              idempotencyKey: uuid(),
            };
      resetAttemptRef.current = attempt;
      setResetFeedback(undefined);
      setResetting(true);

      try {
        const result = await heterogeneousAgentService.consumeCodexRateLimitResetCredit({
          command,
          ...(attempt.creditId ? { creditId: attempt.creditId } : {}),
          env,
          idempotencyKey: attempt.idempotencyKey,
        });
        if (activeSourceKeyRef.current !== requestSourceKey) return;

        applyQuota(result.quota);
        resetAttemptRef.current = null;

        switch (result.outcome) {
          case 'alreadyRedeemed':
          case 'reset': {
            const text = t('heteroAgent.codexQuota.resetSuccess');
            setResetFeedback({ kind: 'success', text });
            toast.success(text);
            break;
          }
          case 'nothingToReset': {
            setResetFeedback({
              kind: 'info',
              text: t('heteroAgent.codexQuota.resetNothingToReset'),
            });
            break;
          }
          case 'noCredit': {
            setResetFeedback({
              kind: 'error',
              text: t('heteroAgent.codexQuota.resetNoCredit'),
            });
            break;
          }
        }
      } catch (error) {
        console.error('Failed to consume Codex rate-limit reset credit:', error);
        if (activeSourceKeyRef.current !== requestSourceKey) return;

        const text = t('heteroAgent.codexQuota.resetFailed');
        setResetFeedback({ kind: 'error', text });
        toast.error(text);
      } finally {
        if (activeSourceKeyRef.current === requestSourceKey) setResetting(false);
      }
    },
    [command, env, t],
  );

  const confirmReset = useCallback(
    (creditId: string | undefined, applyQuota: (quota: CodexQuotaSnapshot) => void) => {
      const requestSourceKey = sourceKey;
      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('heteroAgent.codexQuota.resetConfirmDescription'),
        okText: t('heteroAgent.codexQuota.resetNow'),
        onOk: () => consumeReset(creditId, applyQuota, requestSourceKey),
        title: t('heteroAgent.codexQuota.resetConfirmTitle'),
      });
    },
    [consumeReset, sourceKey, t],
  );

  const renderFooter = useCallback(
    (
      quota: CodexQuotaSnapshot,
      { applyQuota, formatDuration, now }: QuotaMenuHelpers<CodexQuotaSnapshot>,
    ) => {
      const resetCredits = quota.rateLimitResetCredits;

      if (!resetCredits) {
        return (
          <Flexbox className={styles.resetCredits} gap={4}>
            <Flexbox horizontal align={'center'} gap={4}>
              <Icon icon={RotateCcwIcon} size={14} />
              <Text style={{ fontSize: 12 }} type="secondary">
                {t('heteroAgent.codexQuota.resetCreditsUnavailable')}
              </Text>
            </Flexbox>
          </Flexbox>
        );
      }

      const resetCreditCount = resetCredits.availableCount;
      const availableCredits = getAvailableResetCredits(resetCredits.credits, now).slice(
        0,
        resetCreditCount,
      );
      const nextCredit = availableCredits[0];
      const resetCreditItems = Array.from({ length: resetCreditCount }, (_, index) => ({
        credit: availableCredits[index],
        index: index + 1,
      }));

      return (
        <Flexbox className={styles.resetCredits} gap={8}>
          <Flexbox gap={2}>
            <Flexbox horizontal align={'center'} gap={4}>
              <Icon icon={RotateCcwIcon} size={14} />
              <Text strong style={{ fontSize: 12 }}>
                {t('heteroAgent.codexQuota.resetCredits', { count: resetCreditCount })}
              </Text>
            </Flexbox>
            {resetCredits.totalEarnedCount !== undefined && (
              <Text color={cssVar.colorTextTertiary} style={{ fontSize: 12 }}>
                {t('heteroAgent.codexQuota.totalEarned', {
                  count: resetCredits.totalEarnedCount,
                })}
              </Text>
            )}
          </Flexbox>

          {resetCreditItems.length > 0 && (
            <Flexbox className={styles.creditList}>
              {resetCreditItems.map(({ credit, index }) => {
                const fallbackExpiry = index === 1 ? resetCredits.nextExpiresAt : undefined;
                const expiresAt = credit ? credit.expiresAt : fallbackExpiry;
                const expiresIn = expiresAt ? formatDuration(expiresAt - now) : undefined;

                return (
                  <Flexbox
                    horizontal
                    align={'center'}
                    className={styles.credit}
                    gap={8}
                    key={credit?.id ?? `reset-credit-${index}`}
                  >
                    <Text className={styles.creditIndex} style={{ fontSize: 12 }}>
                      {`#${index}`}
                    </Text>
                    <Text strong className={styles.creditTitle} style={{ fontSize: 12 }}>
                      {credit?.title || t('heteroAgent.codexQuota.resetCreditTitle')}
                    </Text>
                    <Text className={styles.creditExpiry} style={{ fontSize: 12 }} type="secondary">
                      {expiresAt
                        ? expiresIn
                          ? t('heteroAgent.codexQuota.expiresIn', { duration: expiresIn })
                          : t('heteroAgent.codexQuota.expiresSoon')
                        : credit
                          ? t('heteroAgent.codexQuota.doesNotExpire')
                          : t('heteroAgent.codexQuota.resetCreditDetailsUnavailable')}
                    </Text>
                  </Flexbox>
                );
              })}
            </Flexbox>
          )}

          {resetFeedback && (
            <div
              aria-live="polite"
              className={styles.feedback}
              data-kind={resetFeedback.kind}
              role={resetFeedback.kind === 'error' ? 'alert' : 'status'}
            >
              {resetFeedback.text}
            </div>
          )}

          {resetCreditCount > 0 && (
            <Button
              block
              icon={RotateCcwIcon}
              loading={resetting}
              size={'small'}
              type={'primary'}
              onClick={() => confirmReset(nextCredit?.id ?? undefined, applyQuota)}
            >
              {resetting
                ? t('heteroAgent.codexQuota.resetting')
                : t('heteroAgent.codexQuota.resetNow')}
            </Button>
          )}
        </Flexbox>
      );
    },
    [confirmReset, resetFeedback, resetting, t],
  );

  return (
    <QuotaMenu
      contentWidth={360}
      createErrorSnapshot={createErrorSnapshot}
      fetchQuota={fetchQuota}
      getWindows={getWindows}
      hasExtraData={hasExtraData}
      renderFooter={renderFooter}
      sourceKey={sourceKey}
      title={t('heteroAgent.codexQuota.title')}
      tooltip={t('heteroAgent.codexQuota.tooltip')}
    />
  );
});

CodexQuotaMenu.displayName = 'CodexQuotaMenu';

export default CodexQuotaMenu;
