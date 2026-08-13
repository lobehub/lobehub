'use client';

import { ActionIcon, Flexbox, Text, Tooltip } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { PencilIcon, SparklesIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { createAgentIdentityModal } from '@/features/AgentIdentityModal';
import { AgentProfileArtwork } from '@/features/AgentProfileArtwork';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import {
  agentProjectionSelectors,
  useAgentConfig,
  useAgentMeta,
  useAgentValue,
} from '@/store/agent/projection';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';

import { useAutoName } from './useAutoName';

const AgentHeader = memo(() => {
  const { t } = useTranslation(['setting', 'common']);
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);
  const { allowed: canEdit } = usePermission('edit_own_content');

  const agentId = useAgentStore((s) => s.activeAgentId || '');
  const meta = useAgentMeta(agentId);
  const config = useAgentConfig(agentId);
  const slug = useAgentValue(agentId, agentProjectionSelectors.slug);
  const updateMetaById = useAgentStore((s) => s.updateAgentMetaById);
  const { autoName, naming } = useAutoName(agentId);
  // Without edit rights there is nothing to prompt for, so a nameless agent
  // falls back to the plain label rather than showing an action nobody can take.
  const showNamePrompt = !meta.name?.trim() && canEdit;

  return (
    <Flexbox
      gap={16}
      paddingBlock={'0 16px'}
      style={{
        cursor: 'default',
        marginInline: -16,
        width: 'calc(100% + 32px)',
      }}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <AgentProfileArtwork
        agentId={agentId}
        avatar={meta.avatar}
        background={meta.backgroundColor}
        canEdit={canEdit}
        description={meta.description}
        locale={locale}
        name={meta.name}
        systemRole={config?.systemRole}
        title={meta.title}
        onAvatarChange={(avatar) => {
          if (canEdit) void updateMetaById(agentId, { avatar });
        }}
        onBackgroundChange={(backgroundColor) => {
          if (canEdit) void updateMetaById(agentId, { backgroundColor });
        }}
      />
      {/* Identity Section — display only. Editing all three fields happens in a
          form modal; inline inputs crowded the header and left no room for a
          per-field label or error. */}
      <Flexbox flex={1} gap={8} paddingInline={24} style={{ minWidth: 0 }}>
        {/* The headline is the NAME slot. It does not borrow the role the way
            list surfaces do — the role has its own line right below, and falling
            back would print it twice (an agent titled "Lobe AI" read
            "Lobe AI / Lobe AI · @inbox").

            With no name there is nothing to headline, so the slot carries the
            one thing that can fix it instead of a placeholder pretending to be a
            name. The edit affordance stays hidden until then: naming it IS the
            next step, and offering the full identity form alongside would split
            attention between two ways to do the same thing. */}
        {showNamePrompt ? (
          <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
            <Text ellipsis style={{ color: cssVar.colorTextTertiary, fontSize: 20 }}>
              {t('settingAgent.personalName.unnamed', { ns: 'setting' })}
            </Text>
            <Button
              icon={SparklesIcon}
              loading={naming}
              size={'small'}
              type={'text'}
              onClick={() => {
                void autoName();
              }}
            >
              {t('settingAgent.personalName.pickForMe', { ns: 'setting' })}
            </Button>
          </Flexbox>
        ) : (
          <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
            <Text ellipsis style={{ fontSize: 36, fontWeight: 600 }}>
              {meta.name?.trim() || t('settingAgent.identity.untitled', { ns: 'setting' })}
            </Text>
            {canEdit ? (
              <ActionIcon
                icon={PencilIcon}
                size={'small'}
                title={t('settingAgent.identity.edit', { ns: 'setting' })}
                onClick={() => createAgentIdentityModal(agentId)}
              />
            ) : null}
          </Flexbox>
        )}
        <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
          {/* `Text type="secondary"` resolves to `colorTextDescription`, which antd
              maps to the TERTIARY step — too faint for the line that carries the
              agent's role. Set the secondary colour explicitly, and leave only
              the decorative `@` and the separator at tertiary. */}
          {/* The role always occupies its slot. An agent with no role gets a
              stated placeholder rather than a gap — otherwise the line silently
              collapses to a bare slug and the missing role is indistinguishable
              from a role that was never meant to be there. */}
          <Text
            ellipsis
            style={{
              color: meta.title?.trim() ? cssVar.colorTextSecondary : cssVar.colorTextTertiary,
            }}
          >
            {meta.title?.trim() || t('settingAgent.role.unset', { ns: 'setting' })}
          </Text>
          {slug ? <Text style={{ color: cssVar.colorTextTertiary }}>·</Text> : null}
          {/* The tooltip only renders when a slug exists, so it can always name
              the real url rather than a `<slug>` the reader has to substitute. */}
          {slug ? (
            <Tooltip title={t('settingAgent.slug.openWith', { ns: 'setting', slug })}>
              <Text code style={{ color: cssVar.colorTextSecondary, flex: 'none' }}>
                <span style={{ color: cssVar.colorTextTertiary }}>@</span>
                {slug}
              </Text>
            </Tooltip>
          ) : null}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

export default AgentHeader;
