'use client';

import { AGENT_SHARE_VISITOR_TOPIC_LIST_LIMIT } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { InputNumber } from '@lobehub/ui/base-ui';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Section, SettingRow } from './SectionLayout';
import type { AgentShareConfigPatch, AgentShareConfigState } from './useAgentShare';
import { type AgentShareLimitPatch, useDebouncedLimitPatch } from './useDebouncedLimitPatch';

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

  // Typing must not fire a request per keystroke: the drafts hold the raw
  // input and the debounced patch commits only valid values. A draft entry is
  // dropped once the write it belongs to has settled, so the field falls back
  // to the (now updated) server value.
  const [countDraft, setCountDraft] = useState<Partial<Record<CountField, number>>>({});
  const [spendDraft, setSpendDraft] = useState<number | undefined>();

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

  const schedule = useDebouncedLimitPatch(agentId, async (patch) => onChange(patch), settle);

  const handleCountChange = (field: CountField, value: number | null) => {
    setCountDraft((prev) => {
      const next = { ...prev };
      if (value === null) delete next[field];
      else next[field] = value;
      return next;
    });
    // The server schema only accepts positive integers; an empty or invalid
    // field just holds the draft until it becomes valid again.
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
      const patch: AgentShareLimitPatch = { [field]: value };
      schedule(patch);
    }
  };

  const handleSpendChange = (value: number | null) => {
    // `null` is an empty/half-typed field, NOT "no cap": the cap is mandatory,
    // so hold the draft and commit nothing until a number comes back.
    if (value === null) return;
    setSpendDraft(value);
    if (value >= 0) schedule({ monthlySpendLimit: value });
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
            value={countDraft.maxTopicsPerVisitor ?? shareConfig.maxTopicsPerVisitor ?? null}
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
            value={countDraft.maxTurnsPerTopic ?? shareConfig.maxTurnsPerTopic ?? null}
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
            value={spendDraft ?? shareConfig.monthlySpendLimit ?? null}
            onChange={handleSpendChange}
          />
        </SettingRow>
      </Flexbox>
    </Section>
  );
});

LimitsSection.displayName = 'AgentShareLimitsSection';

export default LimitsSection;
