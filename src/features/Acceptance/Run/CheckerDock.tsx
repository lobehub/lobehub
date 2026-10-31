import type { VerifyCheckItem } from '@lobechat/types';
import { ActionIcon, Button, Flexbox, Icon, Input, useThemeMode } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleAlert,
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
import type { VerifyCheckResultItem } from '@/database/schemas/verify';
import { verifyService } from '@/services/verify';
import { useChatStore } from '@/store/chat';

import { useVerifyResults, useVerifyState } from '../hooks';
import { countResults, phaseFromStatus } from '../utils';

const styles = stylex.create({
  actions: {
    marginBlockStart: '12px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  body: {
    paddingBlockStart: '0',
    paddingBlockEnd: '12px',
    paddingInline: '12px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  bodyEmbedded: { borderBlockStartStyle: 'none' },
  checkRow: {
    display: 'grid',
    gridTemplateColumns: '20px minmax(0, 1fr) auto',
    gap: '8px',
    alignItems: 'start',
    paddingBlock: '12px',
    borderBlockEndWidth: { 'default': null, ':not(:last-child)': '1px' },
    borderBlockEndStyle: { 'default': null, ':not(:last-child)': 'solid' },
    borderBlockEndColor: { 'default': null, ':not(:last-child)': cssVar.colorBorderSecondary },
  },
  chevron: { flex: 'none', color: cssVar.colorTextQuaternary },
  clickable: {
    cursor: 'pointer',
    transition: `background 150ms ${cssVar.motionEaseOut}`,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  desc: {
    marginBlockStart: '3px',
    fontSize: '12px',
    lineHeight: 1.45,
    color: cssVar.colorTextTertiary,
  },
  dock: {
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: '16px',
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  head: {
    cursor: 'pointer',
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBlock: '11px',
    paddingInline: '12px',
  },
  inputPanel: {
    marginBlockStart: '10px',
    padding: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '12px',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  sub: {
    overflow: 'hidden',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  title: { fontSize: '13px', fontWeight: 700, color: cssVar.colorText },
});

const statusIcon = (
  status: VerifyCheckResultItem['status'] | undefined,
): { color: keyof typeof cssVar; icon: typeof CheckCircle2; spin: boolean } => {
  switch (status) {
    case 'passed': {
      return { color: 'colorSuccess', icon: CheckCircle2, spin: false };
    }
    case 'running': {
      return { color: 'colorInfo', icon: LoaderCircle, spin: true };
    }
    case 'failed': {
      return { color: 'colorError', icon: XCircle, spin: false };
    }
    case 'skipped': {
      return { color: 'colorTextQuaternary', icon: CircleAlert, spin: false };
    }
    default: {
      return { color: 'colorTextQuaternary', icon: Circle, spin: false };
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
 * (draft → verifying → failed/repairing → passed) with confirm / edit / skip.
 */
const CheckerDock = memo<CheckerDockProps>(({ operationId, embedded }) => {
  const { isDarkMode } = useThemeMode();
  const { t } = useTranslation('verify');
  const { data: state, mutate: mutateState } = useVerifyState(operationId);
  const { data: results, mutate: mutateResults } = useVerifyResults(operationId);
  const openVerifyResult = useChatStore((s) => s.openVerifyResult);

  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draftItems, setDraftItems] = useState<VerifyCheckItem[]>([]);
  const [busy, setBusy] = useState(false);

  const plan = state?.verifyPlan ?? [];
  const phase = phaseFromStatus(state?.verifyStatus);
  const counts = countResults(results ?? []);
  const resultByItem = new Map((results ?? []).map((r) => [r.checkItemId, r]));

  if (phase === 'idle' || plan.length === 0) return null;

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
      errored: t('status.errored'),
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
    return (
      <div
        {...stylex.props(styles.checkRow, styles.clickable)}
        key={item.id}
        onClick={() => openVerifyResult(operationId, item.id)}
      >
        {result?.status === 'running' ? (
          <RingLoadingIcon
            size={16}
            style={{ color: cssVar.colorWarning }}
            ringColor={
              isDarkMode
                ? cssVar.colorWarningBorder
                : `color-mix(in srgb, ${cssVar.colorWarning} 45%, transparent)`
            }
          />
        ) : (
          <Icon color={cssVar[sIcon.color]} icon={sIcon.icon} size={16} spin={sIcon.spin} />
        )}
        {/* Title only: the judge's reasoning is long and buries the verdicts;
            it lives in the result detail opened by clicking the row. */}
        <span
          className={stylex.props(styles.title).className}
          style={{ fontWeight: 600, minWidth: 0 }}
        >
          {item.title}
        </span>
        <Icon
          className={stylex.props(styles.chevron).className}
          icon={ChevronRight}
          size={16}
          style={{ marginBlockStart: 2 }}
        />
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
    if (phase === 'repairing')
      return (
        <div className={stylex.props(styles.inputPanel).className} style={{ marginTop: 10 }}>
          <div {...stylex.props(styles.desc)}>{t('dock.repairHint')}</div>
        </div>
      );
    return null;
  };

  const body = (
    <div {...stylex.props(styles.body, embedded && styles.bodyEmbedded)}>
      {editing ? (
        renderEditor()
      ) : (
        <>
          <Flexbox gap={0}>{plan.map((item) => renderCheckRow(item))}</Flexbox>
          {(() => {
            const actions = renderActions();
            return actions ? <div {...stylex.props(styles.actions)}>{actions}</div> : null;
          })()}
        </>
      )}
    </div>
  );

  // Merged verify card: just the checker body (items + actions), no dock chrome.
  if (embedded) return body;

  const headIcon =
    phase === 'passed'
      ? Check
      : phase === 'failed' || phase === 'errored'
        ? ShieldAlert
        : ShieldCheck;

  return (
    <div {...stylex.props(styles.dock)}>
      <div {...stylex.props(styles.head)} onClick={() => setExpanded((v) => !v)}>
        <Flexbox horizontal align="center" gap={10} style={{ minWidth: 0 }}>
          <Icon icon={headIcon} size={18} />
          <Flexbox style={{ minWidth: 0 }}>
            <Flexbox horizontal align="center" gap={8}>
              <span {...stylex.props(styles.title)}>{t('dock.title')}</span>
            </Flexbox>
            <span {...stylex.props(styles.sub)}>{subText}</span>
          </Flexbox>
        </Flexbox>
        <Icon
          color={cssVar.colorTextTertiary}
          icon={expanded ? ChevronDown : ChevronUp}
          size={16}
        />
      </div>
      {expanded && body}
    </div>
  );
});

CheckerDock.displayName = 'CheckerDock';

export default CheckerDock;
