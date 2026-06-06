import { ActionIcon, Button, Flexbox, Icon, Input, TextArea } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  CircleAlert,
  ListTree,
  LoaderCircle,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import RingLoadingIcon from '@/components/RingLoading';
import type { VerifyCheckItem, VerifyCheckResultItem } from '@/database/schemas/verify';
import { verifyService } from '@/services/verify';
import { useChatStore } from '@/store/chat';
import { threadSelectors } from '@/store/chat/selectors';

import { useVerifyResults, useVerifyState } from './hooks';
import { countResults, phaseFromStatus } from './utils';

const useStyles = createStyles(({ css, token }) => ({
  body: css`
    padding: 12px;
    border-block-start: 1px solid ${token.colorBorderSecondary};
  `,
  checkRow: css`
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr) auto;
    gap: 8px;
    align-items: start;

    padding: 8px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 10px;

    background: ${token.colorFillQuaternary};
  `,
  checkRowClickable: css`
    cursor: pointer;
    transition: filter 150ms ${token.motionEaseOut};

    &:hover {
      filter: brightness(1.06);
    }
  `,
  traceHint: css`
    color: ${token.colorTextQuaternary};
  `,
  desc: css`
    margin-block-start: 3px;
    font-size: 12px;
    line-height: 1.45;
    color: ${token.colorTextTertiary};
  `,
  dock: css`
    overflow: hidden;
    border: 1px solid ${token.colorBorder};
    border-radius: 16px;
    background: ${token.colorBgElevated};
  `,
  head: css`
    cursor: pointer;

    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    padding-block: 11px;
    padding-inline: 12px;
  `,
  inputPanel: css`
    margin-block-start: 10px;
    padding: 10px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 12px;

    background: ${token.colorFillQuaternary};
  `,
  sub: css`
    overflow: hidden;

    font-size: 12px;
    color: ${token.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  title: css`
    font-size: 13px;
    font-weight: 700;
    color: ${token.colorText};
  `,
}));

const statusIcon = (status: VerifyCheckResultItem['status'] | undefined) => {
  switch (status) {
    case 'passed': {
      return { color: 'colorSuccess', icon: CheckCircle2, spin: false } as const;
    }
    case 'running': {
      return { color: 'colorInfo', icon: LoaderCircle, spin: true } as const;
    }
    case 'failed': {
      return { color: 'colorError', icon: XCircle, spin: false } as const;
    }
    case 'skipped': {
      return { color: 'colorTextQuaternary', icon: CircleAlert, spin: false } as const;
    }
    default: {
      return { color: 'colorTextQuaternary', icon: Circle, spin: false } as const;
    }
  }
};

interface CheckerDockProps {
  /** Render only the checker body (items + actions), no dock chrome / header — for the merged verify card. */
  embedded?: boolean;
  operationId: string;
}

/**
 * The delivery checker dock — replaces the chat composer during a run. Mirrors
 * the reference mock: a collapsible card driving the plan state machine
 * (draft → verifying → failed/repairing → passed) with confirm / edit / skip
 * and a failure feedback panel.
 */
const CheckerDock = memo<CheckerDockProps>(({ operationId, embedded }) => {
  const { styles, cx, theme } = useStyles();
  const { t } = useTranslation('verify');
  const { data: state, mutate: mutateState } = useVerifyState(operationId);
  const { data: results, mutate: mutateResults } = useVerifyResults(operationId);

  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draftItems, setDraftItems] = useState<VerifyCheckItem[]>([]);
  const [inputText, setInputText] = useState('');
  const [busy, setBusy] = useState(false);

  const plan = state?.verifyPlan ?? [];
  const phase = phaseFromStatus(state?.verifyStatus);
  const counts = countResults(results ?? []);
  const resultByItem = new Map((results ?? []).map((r) => [r.checkItemId, r]));

  if (phase === 'idle' || plan.length === 0) return null;

  const colorOf = (key: string) => (theme as unknown as Record<string, string>)[key];

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await Promise.all([mutateState(), mutateResults()]);
    } finally {
      setBusy(false);
    }
  };

  const onConfirm = () => run(() => verifyService.confirmPlan(operationId));
  const onSkip = () => run(() => verifyService.skipPlan(operationId));
  const onForceDeliver = () => run(() => verifyService.skipPlan(operationId));

  // Open an agent verifier's execution trace (the sub-run thread) in the portal,
  // mirroring how sub-agent renders surface their isolated thread.
  const openAgentTrace = async (verifierOperationId: string) => {
    const resolved = await verifyService.getVerifierThread(verifierOperationId);
    const threadId = resolved?.threadId;
    if (!threadId) return;
    const thread = (threadSelectors.currentTopicThreads(useChatStore.getState()) ?? []).find(
      (t) => t.id === threadId,
    );
    useChatStore.getState().openThreadInPortal(threadId, thread?.sourceMessageId);
  };

  const startEdit = () => {
    setDraftItems(plan.map((i) => ({ ...i })));
    setEditing(true);
    setExpanded(true);
  };
  const saveEdit = () =>
    run(async () => {
      await verifyService.updateDraftItems(
        operationId,
        draftItems.map((item, index) => ({ ...item, index })),
      );
      setEditing(false);
    });

  const subText = (() => {
    const map: Record<string, string> = {
      draft: t('status.draft', { total: plan.length }),
      failed: t('status.failed'),
      passed: t('status.passed', { passed: counts.passed, total: counts.total }),
      repairing: t('status.repairing'),
      verifying: t('status.checking', { passed: counts.passed, total: counts.total }),
    };
    return map[phase] ?? t('status.idle');
  })();

  const renderCheckRow = (item: VerifyCheckItem) => {
    const result = resultByItem.get(item.id);
    const sIcon = statusIcon(result?.status);
    const evidence = result?.toulmin?.reasoning || result?.suggestion;
    // Agent verifiers run in their own thread — let the row open that trace.
    const traceOp = item.verifierType === 'agent' ? result?.verifierOperationId : undefined;
    return (
      <div
        className={cx(styles.checkRow, traceOp && styles.checkRowClickable)}
        key={item.id}
        onClick={traceOp ? () => openAgentTrace(traceOp) : undefined}
      >
        {result?.status === 'running' ? (
          <RingLoadingIcon
            size={16}
            style={{ color: theme.colorWarning }}
            ringColor={
              theme.isDarkMode
                ? theme.colorWarningBorder
                : `color-mix(in srgb, ${theme.colorWarning} 45%, transparent)`
            }
          />
        ) : (
          <Icon color={colorOf(sIcon.color)} icon={sIcon.icon} size={16} spin={sIcon.spin} />
        )}
        <Flexbox style={{ minWidth: 0 }}>
          <span className={styles.title} style={{ fontWeight: 600 }}>
            {item.title}
          </span>
          {evidence && <span className={styles.desc}>{evidence}</span>}
        </Flexbox>
        {traceOp ? (
          <Icon
            className={styles.traceHint}
            icon={ListTree}
            size={14}
            style={{ marginBlockStart: 2 }}
          />
        ) : (
          <span />
        )}
      </div>
    );
  };

  const renderEditor = () => (
    <Flexbox gap={8}>
      {draftItems.map((item, index) => (
        <Flexbox horizontal align="center" gap={7} key={item.id}>
          <Input
            placeholder={t('editor.placeholder')}
            value={item.title}
            onChange={(e) => {
              const next = [...draftItems];
              next[index] = { ...item, title: e.target.value };
              setDraftItems(next);
            }}
          />
          <ActionIcon
            icon={Trash2}
            size="small"
            onClick={() => setDraftItems(draftItems.filter((_, i) => i !== index))}
          />
        </Flexbox>
      ))}
      <Button
        block
        icon={Plus}
        size="small"
        type="dashed"
        onClick={() =>
          setDraftItems([
            ...draftItems,
            {
              id: `tmp-${draftItems.length}-${Date.now()}`,
              index: draftItems.length,
              onFail: 'manual',
              required: false,
              sourceCriterionId: null,
              sourceRubricId: null,
              title: '',
              verifierConfig: {},
              verifierType: 'llm',
            },
          ])
        }
      >
        {t('editor.add')}
      </Button>
      <Flexbox horizontal gap={8}>
        <Button loading={busy} size="small" type="primary" onClick={saveEdit}>
          {t('editor.save')}
        </Button>
        <Button size="small" onClick={() => setEditing(false)}>
          {t('editor.cancel')}
        </Button>
      </Flexbox>
    </Flexbox>
  );

  const renderActions = () => {
    if (phase === 'draft')
      return (
        <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap', marginTop: 12 }}>
          <Button loading={busy} size="small" type="primary" onClick={onConfirm}>
            {t('dock.confirm')}
          </Button>
          <Button size="small" onClick={startEdit}>
            {t('dock.edit')}
          </Button>
          <Button size="small" onClick={onSkip}>
            {t('dock.skip')}
          </Button>
        </Flexbox>
      );
    if (phase === 'failed')
      return (
        <>
          <div className={styles.inputPanel}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{t('input.label')}</div>
            <TextArea
              placeholder={t('input.placeholder')}
              rows={2}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
            />
            <div className={styles.desc} style={{ marginTop: 6 }}>
              {t('input.hint')}
            </div>
          </div>
          <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap', marginTop: 12 }}>
            <Button size="small" onClick={startEdit}>
              {t('dock.edit')}
            </Button>
            <Button danger loading={busy} size="small" onClick={onForceDeliver}>
              {t('dock.forceDeliver')}
            </Button>
          </Flexbox>
        </>
      );
    if (phase === 'repairing')
      return (
        <div className={styles.inputPanel} style={{ marginTop: 10 }}>
          <div className={styles.desc}>{t('dock.repairHint')}</div>
        </div>
      );
    return null;
  };

  const body = (
    <div className={styles.body}>
      {editing ? (
        renderEditor()
      ) : (
        <>
          <Flexbox gap={7}>{plan.map((item) => renderCheckRow(item))}</Flexbox>
          {renderActions()}
        </>
      )}
    </div>
  );

  // Merged verify card: just the checker body (items + actions), no dock chrome.
  if (embedded) return body;

  const headIcon = phase === 'passed' ? Check : phase === 'failed' ? ShieldAlert : ShieldCheck;

  return (
    <div className={styles.dock}>
      <div className={styles.head} onClick={() => setExpanded((v) => !v)}>
        <Flexbox horizontal align="center" gap={10} style={{ minWidth: 0 }}>
          <Icon icon={headIcon} size={18} />
          <Flexbox style={{ minWidth: 0 }}>
            <Flexbox horizontal align="center" gap={8}>
              <span className={styles.title}>{t('dock.title')}</span>
            </Flexbox>
            <span className={styles.sub}>{subText}</span>
          </Flexbox>
        </Flexbox>
        <Icon color={theme.colorTextTertiary} icon={expanded ? ChevronDown : ChevronUp} size={16} />
      </div>
      {expanded && body}
    </div>
  );
});

CheckerDock.displayName = 'CheckerDock';

export default CheckerDock;
