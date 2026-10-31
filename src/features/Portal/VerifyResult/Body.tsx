import type { VerifierType } from '@lobechat/types';
import { formatDuration as formatDurationMs } from '@lobechat/utils';
import { Button, Flexbox, Markdown, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ListTree } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useVerifierTracing,
  useVerifyInstruction,
  useVerifyResults,
  useVerifyState,
} from '@/features/Acceptance/hooks';
import { verifyService } from '@/services/verify';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, threadSelectors } from '@/store/chat/selectors';

const styles = stylex.create({
  confidenceCard: {
    padding: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  confidenceValue: { fontSize: '20px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  fill: {
    height: '100%',
    borderRadius: '999px',
    transition: `width 300ms ${cssVar.motionEaseOut}`,
  },
  label: {
    marginBlockEnd: '6px',
    fontSize: '12px',
    fontWeight: 600,
    color: cssVar.colorTextSecondary,
  },
  metaKey: { color: cssVar.colorTextTertiary },
  metaRow: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: '13px',
  },
  metaValue: {
    overflow: 'hidden',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  text: { fontSize: '13px', lineHeight: 1.7, color: cssVar.colorText },
  track: {
    overflow: 'hidden',
    width: '100%',
    height: '8px',
    borderRadius: '999px',
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
});

/** Score zone → theme color token, mirroring the A/B/F grade bands. */
const confidenceColor = (ratio: number): keyof typeof cssVar => {
  if (ratio >= 0.8) return 'colorSuccess';
  if (ratio >= 0.6) return 'colorWarning';
  return 'colorError';
};

const methodKey = (type: VerifierType) =>
  `detail.method${type.charAt(0).toUpperCase()}${type.slice(1)}`;

const formatDuration = (started?: Date | string | null, completed?: Date | string | null) => {
  if (!started || !completed) return null;
  const ms = +new Date(completed) - +new Date(started);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (ms < 1000) return `${ms}ms`;
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : formatDurationMs(ms);
};

const Field = memo<{ children: ReactNode; label: string }>(({ label, children }) => {
  return (
    <Flexbox>
      <div {...stylex.props(styles.label)}>{label}</div>
      {children}
    </Flexbox>
  );
});

const Body = () => {
  const { t } = useTranslation('verify');
  const operationId = useChatStore(chatPortalSelectors.verifyResultOperationId);
  const checkItemId = useChatStore(chatPortalSelectors.verifyResultCheckItemId);
  const { data: state } = useVerifyState(operationId ?? null);
  const { data: results } = useVerifyResults(operationId ?? null);

  const item = (state?.verifyPlan ?? []).find((i) => i.id === checkItemId);
  const result = (results ?? []).find((r) => r.checkItemId === checkItemId);
  const { data: tracing } = useVerifierTracing(result?.verifierTracingId);
  // The criterion's original judging rule, so the panel shows what was checked,
  // not only the judgment outcome.
  const { data: instructionDoc } = useVerifyInstruction(item?.documentId);

  if (!item) return null;

  const ratio = typeof result?.confidence === 'number' ? result.confidence : undefined;
  const duration = formatDuration(result?.startedAt, result?.completedAt);
  const instruction = instructionDoc?.content;
  const tokens =
    tracing && (tracing.inputTokens != null || tracing.outputTokens != null)
      ? (tracing.inputTokens ?? 0) + (tracing.outputTokens ?? 0)
      : undefined;

  const metaItems: { key: string; value: string }[] = [
    { key: t('detail.method'), value: t(methodKey(item.verifierType) as any) },
    result?.completedAt && {
      key: t('detail.checkedAt'),
      value: new Date(result.completedAt).toLocaleString(),
    },
    duration && { key: t('detail.duration'), value: duration },
    tracing?.model && {
      key: t('detail.model'),
      value: tracing.provider ? `${tracing.provider} / ${tracing.model}` : tracing.model,
    },
    tokens != null && { key: t('detail.tokens'), value: tokens.toLocaleString() },
  ].filter(Boolean) as { key: string; value: string }[];

  const sections: { key: string; value?: string | null }[] = [
    { key: 'reasoning', value: result?.toulmin?.reasoning },
    { key: 'evidence', value: result?.toulmin?.evidence },
    { key: 'counterEvidence', value: result?.toulmin?.counterEvidence },
    { key: 'limitation', value: result?.toulmin?.limitation },
    { key: 'suggestion', value: result?.suggestion },
  ].filter((s) => !!s.value);

  const canOpenTrace = item.verifierType === 'agent' && !!result?.verifierOperationId;

  const openTrace = async () => {
    if (!result?.verifierOperationId) return;
    const resolved = await verifyService.getVerifierThread(result.verifierOperationId);
    const threadId = resolved?.threadId;
    if (!threadId) return;
    const thread = (threadSelectors.currentTopicThreads(useChatStore.getState()) ?? []).find(
      (th) => th.id === threadId,
    );
    useChatStore.getState().openThreadInPortal(threadId, thread?.sourceMessageId);
  };

  return (
    <Flexbox
      gap={16}
      height={'100%'}
      paddingBlock={'4px 16px'}
      paddingInline={8}
      style={{ overflow: 'auto' }}
    >
      {ratio !== undefined && (
        <div {...stylex.props(styles.confidenceCard)}>
          <Flexbox
            horizontal
            align={'baseline'}
            justify={'space-between'}
            style={{ marginBlockEnd: 8 }}
          >
            <span className={stylex.props(styles.label).className} style={{ marginBlockEnd: 0 }}>
              {t('detail.confidence')}
            </span>
            <span
              className={stylex.props(styles.confidenceValue).className}
              style={{ color: cssVar[confidenceColor(ratio)] }}
            >
              {Math.round(ratio * 100)}%
            </span>
          </Flexbox>
          <div {...stylex.props(styles.track)}>
            <div
              className={stylex.props(styles.fill).className}
              style={{
                background: cssVar[confidenceColor(ratio)],
                width: `${Math.round(ratio * 100)}%`,
              }}
            />
          </div>
        </div>
      )}

      {metaItems.length > 0 && (
        <Flexbox gap={8}>
          {metaItems.map((m) => (
            <div {...stylex.props(styles.metaRow)} key={m.key}>
              <span {...stylex.props(styles.metaKey)}>{m.key}</span>
              <span {...stylex.props(styles.metaValue)}>{m.value}</span>
            </div>
          ))}
        </Flexbox>
      )}

      {/* Original criteria — what this check verifies */}
      {item.description && (
        <Field label={t('detail.summary')}>
          <div {...stylex.props(styles.text)}>{item.description}</div>
        </Field>
      )}

      {instruction && (
        <Field label={t('detail.instruction')}>
          <Markdown className={stylex.props(styles.text).className} variant={'chat'}>
            {instruction}
          </Markdown>
        </Field>
      )}

      {canOpenTrace && (
        <Button block icon={ListTree} onClick={openTrace}>
          {t('detail.openTrace')}
        </Button>
      )}

      {!result && <Text type={'secondary'}>{t('detail.pending')}</Text>}

      {/* Judgment outcome */}
      {sections.map((s) => (
        <Field key={s.key} label={t(`detail.${s.key}` as any)}>
          <Markdown className={stylex.props(styles.text).className} variant={'chat'}>
            {s.value!}
          </Markdown>
        </Field>
      ))}
    </Flexbox>
  );
};

export default Body;
