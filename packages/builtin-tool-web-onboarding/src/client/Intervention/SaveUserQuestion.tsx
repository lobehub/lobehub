'use client';

import type { BuiltinInterventionProps, SaveUserQuestionInput } from '@lobechat/types';
import { Avatar, Flexbox, Text } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const chipStyle = {
  background: 'var(--lobe-fill-quaternary)',
  border: '1px solid var(--lobe-colorBorderSecondary)',
  borderRadius: 999,
  color: 'var(--lobe-colorTextSecondary)',
  fontSize: 12,
  padding: '4px 10px',
} as const;

const detailCardStyle = {
  background: 'var(--lobe-fill-tertiary)',
  border: '1px solid var(--lobe-colorBorderSecondary)',
  borderRadius: 12,
  padding: 16,
} as const;

const detailGridStyle = {
  display: 'grid',
  gap: 12,
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
} as const;

const detailValueStyle = {
  background: 'var(--lobe-fill-quaternary)',
  borderRadius: 10,
  color: 'var(--lobe-colorText)',
  fontSize: 14,
  fontWeight: 500,
  minHeight: 40,
  padding: '10px 12px',
} as const;

const SaveUserQuestionIntervention = memo<BuiltinInterventionProps<SaveUserQuestionInput>>(
  ({ args }) => {
    const { t } = useTranslation('chat');

    const agentName = args.agentName?.trim();
    const agentEmoji = args.agentEmoji?.trim();

    const changedFields = useMemo(
      () =>
        [
          agentName && {
            label: t('tool.intervention.onboarding.agentIdentity.name'),
            value: agentName,
          },
          agentEmoji && {
            label: t('tool.intervention.onboarding.agentIdentity.emoji'),
            value: agentEmoji,
          },
        ].filter(Boolean) as Array<{ label: string; value: string }>,
      [agentEmoji, agentName, t],
    );

    return (
      <Flexbox gap={12}>
        <Flexbox gap={4}>
          <Text style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em' }} type="secondary">
            {t('tool.intervention.onboarding.agentIdentity.eyebrow')}
          </Text>
          <Text style={{ fontSize: 16, fontWeight: 600 }}>
            {t('tool.intervention.onboarding.agentIdentity.title')}
          </Text>
          <Text style={{ fontSize: 13 }} type="secondary">
            {t('tool.intervention.onboarding.agentIdentity.description')}
          </Text>
        </Flexbox>

        <div style={detailCardStyle}>
          <Flexbox gap={16}>
            <Flexbox horizontal align="center" gap={12}>
              <Avatar
                avatar={agentEmoji || '🤖'}
                size={48}
                style={{
                  background: 'var(--lobe-fill-quaternary)',
                  borderRadius: 16,
                  flex: 'none',
                }}
              />
              <Flexbox gap={2}>
                <Text style={{ fontSize: 16, fontWeight: 600 }}>
                  {agentName || t('untitledAgent')}
                </Text>
                <Text style={{ fontSize: 12 }} type="secondary">
                  {t('tool.intervention.onboarding.agentIdentity.applyHint')}
                </Text>
              </Flexbox>
            </Flexbox>

            <div style={detailGridStyle}>
              {changedFields.map((field) => (
                <Flexbox gap={6} key={field.label}>
                  <Text style={{ fontSize: 12, fontWeight: 600 }} type="secondary">
                    {field.label}
                  </Text>
                  <div style={detailValueStyle}>{field.value}</div>
                </Flexbox>
              ))}
            </div>

            <Flexbox gap={8}>
              <Text style={{ fontSize: 12, fontWeight: 600 }} type="secondary">
                {t('tool.intervention.onboarding.agentIdentity.targets')}
              </Text>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <span style={chipStyle}>
                  {t('tool.intervention.onboarding.agentIdentity.targetInbox')}
                </span>
                <span style={chipStyle}>
                  {t('tool.intervention.onboarding.agentIdentity.targetOnboarding')}
                </span>
              </div>
            </Flexbox>
          </Flexbox>
        </div>
      </Flexbox>
    );
  },
);

SaveUserQuestionIntervention.displayName = 'SaveUserQuestionIntervention';

export default SaveUserQuestionIntervention;
