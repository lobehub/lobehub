'use client';

import { AGENT_SHARE_VISITOR_TOPIC_LIST_LIMIT } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { InputNumber } from '@lobehub/ui/base-ui';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSWRConfig } from 'swr';

import { shareKeys } from '@/libs/swr/keys';
import { agentShareService } from '@/services/agentShare';

import { Section, SettingRow } from './SectionLayout';
import type { AgentShareConfigPatch, AgentShareConfigState } from './useAgentShare';
import {
  type AgentShareLimitPatch,
  resolveLimitCommitTarget,
  useDebouncedLimitPatch,
} from './useDebouncedLimitPatch';

type CountField = 'maxTopicsPerVisitor' | 'maxTurnsPerTopic';

interface LimitsSectionProps {
  agentId: string;
  onChange: (patch: AgentShareConfigPatch) => void;
  shareConfig: AgentShareConfigState;
}

/**
 * Visitor throughput caps and the creator's monthly spend cap. Every visitor
 * run is billed to the creator, so these are the only things standing between
 * a shared link and an unbounded bill.
 */
const LimitsSection = memo<LimitsSectionProps>(({ agentId, onChange, shareConfig }) => {
  const { t } = useTranslation('agent');
  const { mutate } = useSWRConfig();
  // Read at flush time, never closed over: `useDebouncedLimitPatch` keeps the
  // PREVIOUS render's `commit` in a ref while it drains the identity-change
  // flush, so that closure's captured `agentId` is still the old one. Only
  // this ref — assigned before the hook runs — knows which agent is current.
  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;

  // Typing must not fire a request per keystroke: the drafts hold the raw
  // input and the debounced patch commits only valid values. A draft entry is
  // dropped once the write it belongs to has settled, so the field falls back
  // to the (now updated) server value.
  // Drafts may hold `null` (a cleared field): the input is controlled, so a
  // clear that is not mirrored locally snaps back to the saved value on blur
  // and a clear-then-type replacement gets swallowed.
  const [countDraft, setCountDraft] = useState<Partial<Record<CountField, number | null>>>({});
  const [spendDraft, setSpendDraft] = useState<number | null | undefined>();

  const settle = useCallback((patch: AgentShareLimitPatch) => {
    setCountDraft((prev) => {
      const next = { ...prev };
      for (const field of ['maxTopicsPerVisitor', 'maxTurnsPerTopic'] as CountField[]) {
        if (patch[field] !== undefined && next[field] === patch[field]) delete next[field];
      }
      return next;
    });
    if (patch.monthlySpendLimit !== undefined) {
      setSpendDraft((prev) => (prev === patch.monthlySpendLimit ? undefined : prev));
    }
  }, []);

  const commit = useCallback(
    async (patch: AgentShareLimitPatch, commitIdentity: string) => {
      // The debounced patch was scheduled for the agent this section still
      // renders: go through the shared queue so the optimistic projection and
      // the SWR cache entry stay in lockstep with every other control.
      if (resolveLimitCommitTarget(commitIdentity, agentIdRef.current) === 'current') {
        await onChange(patch);
        return;
      }

      // Flushed BECAUSE `agentId` just changed, so this patch belongs to the
      // agent that was navigated away from. `onChange` would drop it: the
      // parent `useAgentShare` already reset its refs for the new agent at
      // render time, and `updateConfig` bails out on a missing base config.
      // Send it straight to the service instead — this mirrors
      // `useAgentShare`'s existing rule that a write issued for an abandoned
      // identity is still SENT (the row it targets is unchanged), only its
      // local bookkeeping is skipped. Revalidate that agent's own status key
      // so its cached snapshot is not left behind the value just persisted.
      try {
        await agentShareService.updateShareConfig(commitIdentity, patch);
      } finally {
        void mutate(shareKeys.agentShareStatus(commitIdentity));
      }
    },
    [mutate, onChange],
  );

  const schedule = useDebouncedLimitPatch(agentId, commit, settle);

  const handleCountChange = (field: CountField, value: number | null) => {
    setCountDraft((prev) => ({ ...prev, [field]: value }));
    // The server schema only accepts positive integers; an empty or invalid
    // field just holds the draft until it becomes valid again.
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
      const patch: AgentShareLimitPatch = { [field]: value };
      schedule(patch);
    }
  };

  const handleSpendChange = (value: number | null) => {
    // `null` is an empty/half-typed field, NOT "no cap": the cap is mandatory,
    // so hold the (empty) draft and commit nothing until a number comes back.
    setSpendDraft(value);
    if (value !== null && value >= 0) schedule({ monthlySpendLimit: value });
  };

  return (
    <Section desc={t('share.settings.limits.desc')} title={t('share.settings.limits.title')}>
      <Flexbox gap={12}>
        <SettingRow
          desc={t('share.settings.limits.maxTopicsPerVisitorHint')}
          label={t('share.settings.limits.maxTopicsPerVisitor')}
        >
          <InputNumber
            max={AGENT_SHARE_VISITOR_TOPIC_LIST_LIMIT}
            min={1}
            step={1}
            style={{ width: 160 }}
            value={
              countDraft.maxTopicsPerVisitor !== undefined
                ? countDraft.maxTopicsPerVisitor
                : (shareConfig.maxTopicsPerVisitor ?? null)
            }
            onChange={(value) => handleCountChange('maxTopicsPerVisitor', value)}
          />
        </SettingRow>
        <SettingRow
          desc={t('share.settings.limits.maxTurnsPerTopicHint')}
          label={t('share.settings.limits.maxTurnsPerTopic')}
        >
          <InputNumber
            min={1}
            step={1}
            style={{ width: 160 }}
            value={
              countDraft.maxTurnsPerTopic !== undefined
                ? countDraft.maxTurnsPerTopic
                : (shareConfig.maxTurnsPerTopic ?? null)
            }
            onChange={(value) => handleCountChange('maxTurnsPerTopic', value)}
          />
        </SettingRow>
        <SettingRow
          desc={t('share.settings.limits.monthlySpendLimitHint')}
          label={t('share.settings.limits.monthlySpendLimit')}
        >
          <InputNumber
            min={0}
            step={1}
            style={{ width: 160 }}
            value={spendDraft !== undefined ? spendDraft : (shareConfig.monthlySpendLimit ?? null)}
            onChange={handleSpendChange}
          />
        </SettingRow>
      </Flexbox>
    </Section>
  );
});

LimitsSection.displayName = 'AgentShareLimitsSection';

export default LimitsSection;
