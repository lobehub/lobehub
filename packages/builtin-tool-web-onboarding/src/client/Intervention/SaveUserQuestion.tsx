'use client';

import type { BuiltinInterventionProps, SaveUserQuestionInput } from '@lobechat/types';
import { EmojiPicker, Flexbox, Text } from '@lobehub/ui';
import type { CSSProperties } from 'react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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

const nameInputStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--lobe-colorText)',
  flex: 1,
  fontFamily: 'inherit',
  fontSize: 16,
  fontWeight: 600,
  minWidth: 0,
  outline: 'none',
  padding: 0,
};

const emojiPickerStyle: CSSProperties = {
  background: 'var(--lobe-fill-quaternary)',
  borderRadius: 16,
  cursor: 'pointer',
  flex: 'none',
};

interface DetailField {
  label: string;
  value: string;
}

interface AgentIdentitySectionProps {
  args: SaveUserQuestionInput;
  onArgsChange?: BuiltinInterventionProps<SaveUserQuestionInput>['onArgsChange'];
  registerBeforeApprove?: BuiltinInterventionProps<SaveUserQuestionInput>['registerBeforeApprove'];
}

const AgentIdentitySection = memo<AgentIdentitySectionProps>(
  ({ args, onArgsChange, registerBeforeApprove }) => {
    const { i18n, t } = useTranslation('chat');

    const [name, setName] = useState(args.agentName ?? '');
    const [emoji, setEmoji] = useState(args.agentEmoji ?? '');

    // Flush local edits into args before the framework triggers the actual save.
    useEffect(() => {
      if (!registerBeforeApprove || !onArgsChange) return;
      return registerBeforeApprove('agentIdentity', async () => {
        const trimmedName = name.trim();
        const trimmedEmoji = emoji.trim();
        await onArgsChange({
          ...args,
          agentEmoji: trimmedEmoji || undefined,
          agentName: trimmedName || undefined,
        });
      });
    }, [args, emoji, name, onArgsChange, registerBeforeApprove]);

    // Manifest routes name-only and emoji-only saves through the same intervention,
    // so the title must reflect the *live* edit state — adding a previously-missing
    // field via the input/picker should flip the wording accordingly, instead of
    // promising a name change that was never proposed (or vice versa).
    const titleKey =
      name && emoji
        ? 'tool.intervention.onboarding.agentIdentity.title'
        : name
          ? 'tool.intervention.onboarding.agentIdentity.titleNameOnly'
          : 'tool.intervention.onboarding.agentIdentity.titleAvatarOnly';

    return (
      <Flexbox gap={12}>
        <Flexbox gap={4}>
          <Text style={{ fontSize: 16, fontWeight: 600 }}>{t(titleKey)}</Text>
          <Text style={{ fontSize: 13 }} type="secondary">
            {t('tool.intervention.onboarding.agentIdentity.editHint')}
          </Text>
        </Flexbox>

        <div style={detailCardStyle}>
          <Flexbox horizontal align="center" gap={12}>
            <EmojiPicker
              defaultAvatar={'🤖'}
              locale={i18n.language}
              shape={'square'}
              size={48}
              style={emojiPickerStyle}
              value={emoji}
              onChange={setEmoji}
            />
            <input
              aria-label={t('tool.intervention.onboarding.agentIdentity.namePlaceholder')}
              placeholder={t('tool.intervention.onboarding.agentIdentity.namePlaceholder')}
              style={nameInputStyle}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Flexbox>
        </div>
      </Flexbox>
    );
  },
);

AgentIdentitySection.displayName = 'AgentIdentitySection';

interface UserProfileSectionProps {
  fullName?: string;
}

const UserProfileSection = memo<UserProfileSectionProps>(({ fullName }) => {
  const { t } = useTranslation('chat');

  const fields = useMemo<DetailField[]>(
    () =>
      [
        fullName && {
          label: t('tool.intervention.onboarding.userProfile.fullName'),
          value: fullName,
        },
      ].filter(Boolean) as DetailField[],
    [fullName, t],
  );

  if (fields.length === 0) return null;

  return (
    <Flexbox gap={12}>
      <Flexbox gap={4}>
        <Text style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em' }} type="secondary">
          {t('tool.intervention.onboarding.userProfile.eyebrow')}
        </Text>
        <Text style={{ fontSize: 16, fontWeight: 600 }}>
          {t('tool.intervention.onboarding.userProfile.title')}
        </Text>
        <Text style={{ fontSize: 13 }} type="secondary">
          {t('tool.intervention.onboarding.userProfile.description')}
        </Text>
      </Flexbox>

      <div style={detailCardStyle}>
        <Flexbox gap={16}>
          <div style={detailGridStyle}>
            {fields.map((field) => (
              <Flexbox gap={6} key={field.label}>
                <Text style={{ fontSize: 12, fontWeight: 600 }} type="secondary">
                  {field.label}
                </Text>
                <div style={detailValueStyle}>{field.value}</div>
              </Flexbox>
            ))}
          </div>
          <Text style={{ fontSize: 12 }} type="secondary">
            {t('tool.intervention.onboarding.userProfile.applyHint')}
          </Text>
        </Flexbox>
      </div>
    </Flexbox>
  );
});

UserProfileSection.displayName = 'UserProfileSection';

const SaveUserQuestionIntervention = memo<BuiltinInterventionProps<SaveUserQuestionInput>>(
  ({ args, onArgsChange, registerBeforeApprove }) => {
    const fullName = args.fullName?.trim() || undefined;

    const hasAgentIdentity = Boolean(args.agentName || args.agentEmoji);
    const hasUserProfile = Boolean(fullName);

    return (
      <Flexbox gap={16}>
        {hasAgentIdentity && (
          <AgentIdentitySection
            args={args}
            registerBeforeApprove={registerBeforeApprove}
            onArgsChange={onArgsChange}
          />
        )}
        {hasUserProfile && <UserProfileSection fullName={fullName} />}
      </Flexbox>
    );
  },
);

SaveUserQuestionIntervention.displayName = 'SaveUserQuestionIntervention';

export default SaveUserQuestionIntervention;
