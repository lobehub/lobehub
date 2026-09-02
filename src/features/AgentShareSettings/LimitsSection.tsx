'use client';

import { Flexbox } from '@lobehub/ui';
import { InputNumber, Switch } from '@lobehub/ui/base-ui';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Section, SettingRow } from './SectionLayout';
import type { AgentShareConfigPatch, AgentShareConfigState } from './useAgentShare';
import { type AgentShareLimitPatch, useDebouncedLimitPatch } from './useDebouncedLimitPatch';

/** Default cap offered when the owner first switches the monthly budget on. */
const DEFAULT_MONTHLY_SPEND_LIMIT = 10;

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
  // `null` is a meaningful draft value here ("unlimited"), so absence is
  // expressed with the wrapper object rather than with `null` itself.
  const [spendDraft, setSpendDraft] = useState<{ value: number | null } | undefined>();

  const settle = useCallback((patch: AgentShareLimitPatch) => {
    setCountDraft((prev) => {
      const next = { ...prev };
      for (const field of ['maxTopicsPerVisitor', 'maxTurnsPerTopic'] as CountField[]) {
        if (patch[field] !== undefined && next[field] === patch[field]) delete next[field];
      }
      return next;
    });
    if ('monthlySpendLimit' in patch) {
      setSpendDraft((prev) => (prev && prev.value === patch.monthlySpendLimit ? undefined : prev));
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
    setSpendDraft({ value });
    // `null` removes the cap entirely — unlimited, not zero.
    if (value === null || value >= 0) schedule({ monthlySpendLimit: value });
  };

  const spendLimit = spendDraft ? spendDraft.value : (shareConfig.monthlySpendLimit ?? null);
  const hasSpendLimit = spendLimit !== null;

  return (
    <Section desc={t('share.settings.limits.desc')} title={t('share.settings.limits.title')}>
      <Flexbox gap={12}>
        <SettingRow
          desc={t('share.settings.limits.maxTopicsPerVisitorHint')}
          label={t('share.settings.limits.maxTopicsPerVisitor')}
        >
          <InputNumber
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
          label={t('share.settings.limits.monthlySpendLimit')}
          desc={
            hasSpendLimit
              ? t('share.settings.limits.monthlySpendLimitHint')
              : t('share.settings.limits.monthlySpendUnlimited')
          }
        >
          <Flexbox horizontal align={'center'} gap={8}>
            {hasSpendLimit && (
              <InputNumber
                min={0}
                step={1}
                style={{ width: 120 }}
                value={spendLimit}
                onChange={(value) => handleSpendChange(value ?? 0)}
              />
            )}
            <Switch
              checked={hasSpendLimit}
              onChange={(checked) =>
                handleSpendChange(checked ? DEFAULT_MONTHLY_SPEND_LIMIT : null)
              }
            />
          </Flexbox>
        </SettingRow>
      </Flexbox>
    </Section>
  );
});

LimitsSection.displayName = 'AgentShareLimitsSection';

export default LimitsSection;
