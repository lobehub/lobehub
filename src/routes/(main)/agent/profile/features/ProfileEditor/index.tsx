'use client';

import { Button, Flexbox, toast } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import IdentityFields from '@/features/AgentIdentityModal/IdentityFields';
import { useAgentIdentityForm } from '@/features/AgentIdentityModal/useAgentIdentityForm';
import { AgentProfileArtwork } from '@/features/AgentProfileArtwork';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';

/** The identity fields on the page, saved together with one button. */
const IdentityForm = memo<{ agentId: string }>(({ agentId }) => {
  const { t } = useTranslation(['common', 'setting']);
  const meta = useAgentStore(agentSelectors.getAgentMetaById(agentId), isEqual);
  const slug = useAgentStore(agentSelectors.getAgentSlugById(agentId));
  const form = useAgentIdentityForm({
    agentId,
    onSaved: () => toast.success(t('settingAgent.identity.saved', { ns: 'setting' })),
  });

  const dirty =
    form.name.trim() !== (meta.name ?? '').trim() ||
    form.title.trim() !== (meta.title ?? '').trim() ||
    form.description.trim() !== (meta.description ?? '').trim() ||
    (!form.slugLocked && form.slug.trim().toLowerCase() !== (slug ?? ''));

  return (
    <Flexbox gap={20}>
      <IdentityFields agentId={agentId} autoFocus={false} form={form} />
      <Flexbox horizontal gap={8}>
        <Button
          disabled={!dirty || form.saving}
          loading={form.saving}
          type={'primary'}
          onClick={() => {
            void form.save();
          }}
        >
          {t('save', { ns: 'common' })}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

IdentityForm.displayName = 'IdentityForm';

/**
 * The Profile page: the agent's face — avatar and cover — and who it is, as the identity form
 * right on the page. The instruction, what runs it and what it can use each have their own page.
 */
const ProfileEditor = memo(() => {
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);
  const { allowed: canEdit } = usePermission('edit_own_content');
  const agentId = useAgentStore((s) => s.activeAgentId || '');
  const meta = useAgentStore(agentSelectors.getAgentMetaById(agentId), isEqual);
  const config = useAgentStore(agentSelectors.getAgentConfigById(agentId), isEqual);
  /** Keeps the render-only fallback avatar out of generation references. */
  const storedAvatar = useAgentStore(agentSelectors.getAgentStoredAvatarById(agentId));
  const updateMetaById = useAgentStore((s) => s.updateAgentMetaById);

  return (
    <Flexbox
      gap={32}
      paddingBlock={'0 48px'}
      // Clicking here must not pull focus into the prompt editor of the shared session.
      style={{ cursor: 'default' }}
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <Flexbox style={{ marginInline: -16, width: 'calc(100% + 32px)' }}>
        <AgentProfileArtwork
          agentId={agentId}
          avatar={meta.avatar}
          background={meta.backgroundColor}
          canEdit={canEdit}
          description={meta.description}
          locale={locale}
          name={meta.name}
          storedAvatar={storedAvatar}
          systemRole={config?.systemRole}
          title={meta.title}
          onAvatarChange={(avatar) => {
            if (canEdit) void updateMetaById(agentId, { avatar });
          }}
          onBackgroundChange={(backgroundColor) => {
            if (canEdit) void updateMetaById(agentId, { backgroundColor });
          }}
        />
      </Flexbox>
      {/* Keyed by agent so switching agents starts the form from that agent's values. */}
      <IdentityForm agentId={agentId} key={agentId} />
    </Flexbox>
  );
});

ProfileEditor.displayName = 'ProfileEditor';

export default ProfileEditor;
