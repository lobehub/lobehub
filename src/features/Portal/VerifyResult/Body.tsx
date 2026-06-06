import { Button, Flexbox, Icon, Markdown, Text } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { CheckCircle2, Circle, CircleAlert, ListTree, LoaderCircle, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { VerifyCheckResultItem } from '@/database/schemas/verify';
import { useVerifyResults, useVerifyState } from '@/features/Verify/hooks';
import { verifyService } from '@/services/verify';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, threadSelectors } from '@/store/chat/selectors';

const useStyles = createStyles(({ css, token }) => ({
  badge: css`
    display: inline-flex;
    gap: 5px;
    align-items: center;

    font-size: 13px;
    font-weight: 600;
  `,
  confidence: css`
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  label: css`
    margin-block-end: 6px;
    font-size: 12px;
    font-weight: 600;
    color: ${token.colorTextSecondary};
  `,
  section: css`
    padding: 12px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    font-size: 13px;
    line-height: 1.6;
    color: ${token.colorText};

    background: ${token.colorFillQuaternary};
  `,
}));

const statusMeta = (status: VerifyCheckResultItem['status'] | undefined) => {
  switch (status) {
    case 'passed': {
      return { color: 'colorSuccess', icon: CheckCircle2 } as const;
    }
    case 'running': {
      return { color: 'colorInfo', icon: LoaderCircle } as const;
    }
    case 'failed': {
      return { color: 'colorError', icon: XCircle } as const;
    }
    case 'skipped': {
      return { color: 'colorTextQuaternary', icon: CircleAlert } as const;
    }
    default: {
      return { color: 'colorTextQuaternary', icon: Circle } as const;
    }
  }
};

const Field = memo<{ children: ReactNode; label: string }>(({ label, children }) => {
  const { styles } = useStyles();
  return (
    <Flexbox>
      <div className={styles.label}>{label}</div>
      {children}
    </Flexbox>
  );
});

const Body = () => {
  const { styles, theme } = useStyles();
  const { t } = useTranslation('verify');
  const operationId = useChatStore(chatPortalSelectors.verifyResultOperationId);
  const checkItemId = useChatStore(chatPortalSelectors.verifyResultCheckItemId);
  const { data: state } = useVerifyState(operationId ?? null);
  const { data: results } = useVerifyResults(operationId ?? null);

  const item = (state?.verifyPlan ?? []).find((i) => i.id === checkItemId);
  const result = (results ?? []).find((r) => r.checkItemId === checkItemId);

  if (!item) return null;

  const sIcon = statusMeta(result?.status);
  const colorOf = (key: string) => (theme as unknown as Record<string, string>)[key];

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
      <Flexbox horizontal align={'center'} gap={10}>
        <span className={styles.badge} style={{ color: colorOf(sIcon.color) }}>
          <Icon icon={sIcon.icon} size={15} spin={result?.status === 'running'} />
          {result?.verdict ?? result?.status ?? 'pending'}
        </span>
        {typeof result?.confidence === 'number' && (
          <span className={styles.confidence}>
            {t('detail.confidence')} {Math.round(result.confidence * 100)}%
          </span>
        )}
      </Flexbox>

      {item.description && (
        <Field label={t('detail.summary')}>
          <div className={styles.section}>{item.description}</div>
        </Field>
      )}

      {canOpenTrace && (
        <Button block icon={ListTree} onClick={openTrace}>
          {t('detail.openTrace')}
        </Button>
      )}

      {!result && <Text type={'secondary'}>{t('detail.pending')}</Text>}

      {sections.map((s) => (
        <Field key={s.key} label={t(`detail.${s.key}` as any)}>
          <div className={styles.section}>
            <Markdown variant={'chat'}>{s.value!}</Markdown>
          </div>
        </Field>
      ))}
    </Flexbox>
  );
};

export default Body;
