'use client';

import { KLAVIS_SERVER_TYPES, LOBEHUB_SKILL_PROVIDERS } from '@lobechat/const';
import type { BuiltinInterventionProps } from '@lobechat/types';
import { Avatar, Flexbox } from '@lobehub/ui';
import { CheckCircle } from 'lucide-react';
import Image from 'next/image';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import {
  klavisStoreSelectors,
  lobehubSkillStoreSelectors,
  mcpStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import { KlavisServerStatus } from '@/store/tool/slices/klavisStore/types';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';

import type { InstallPluginParams } from '../../types';

/**
 * InstallPlugin Intervention Component
 *
 * This component only renders the UI for user confirmation.
 * The actual OAuth flow and installation logic is handled in ExecutionRuntime.installPlugin()
 * which runs after the user approves the intervention.
 */
const InstallPluginIntervention = memo<BuiltinInterventionProps<InstallPluginParams>>(
  ({ args }) => {
    const { identifier, source } = args;
    const { t } = useTranslation('chat');

    // Tool store selectors
    const isPluginInstalled = useToolStore((s) => pluginSelectors.isPluginInstalled(identifier)(s));

    // Get Klavis server state
    const klavisServer = useToolStore((s) =>
      klavisStoreSelectors.getServers(s).find((srv) => srv.identifier === identifier),
    );

    // Get LobehubSkill server state
    const lobehubSkillServer = useToolStore((s) =>
      lobehubSkillStoreSelectors.getServers(s).find((srv) => srv.identifier === identifier),
    );

    // Get Market MCP plugin info
    const marketPlugin = useToolStore((s) => mcpStoreSelectors.getPluginById(identifier)(s));

    // Get Builtin tool info
    const builtinTool = useToolStore((s) =>
      s.builtinTools.find((tool) => tool.identifier === identifier),
    );

    // Check if it's a Klavis tool
    const klavisTypeInfo = KLAVIS_SERVER_TYPES.find((t) => t.identifier === identifier);
    const isKlavis = source === 'official' && !!klavisTypeInfo;

    // Check if it's a LobehubSkill provider
    const lobehubSkillProviderInfo = LOBEHUB_SKILL_PROVIDERS.find((p) => p.id === identifier);
    const isLobehubSkill = source === 'official' && !!lobehubSkillProviderInfo;

    // Render success state (already installed)
    if (isPluginInstalled) {
      return (
        <Flexbox
          horizontal
          align="center"
          gap={12}
          style={{
            background: 'var(--lobe-fill-tertiary)',
            borderRadius: 8,
            padding: 16,
          }}
        >
          <CheckCircle size={20} style={{ color: 'var(--lobe-success-6)' }} />
          <Flexbox gap={4}>
            <span style={{ fontWeight: 600 }}>
              {isKlavis || isLobehubSkill
                ? t('agentBuilder.installPlugin.connectedAndEnabled')
                : t('agentBuilder.installPlugin.installedAndEnabled')}
            </span>
            <span style={{ color: 'var(--lobe-text-secondary)', fontSize: 12 }}>
              {klavisTypeInfo?.label || lobehubSkillProviderInfo?.label || identifier}
            </span>
          </Flexbox>
        </Flexbox>
      );
    }

    // Render Klavis tool
    if (isKlavis) {
      const icon = typeof klavisTypeInfo?.icon === 'string' ? klavisTypeInfo.icon : undefined;
      const isPendingAuth = klavisServer?.status === KlavisServerStatus.PENDING_AUTH;

      return (
        <Flexbox
          gap={12}
          style={{ background: 'var(--lobe-fill-tertiary)', borderRadius: 8, padding: 16 }}
        >
          <Flexbox horizontal align="center" gap={12}>
            {icon ? (
              <Image
                unoptimized
                alt={klavisTypeInfo?.label || identifier}
                height={40}
                src={icon}
                style={{ borderRadius: 8 }}
                width={40}
              />
            ) : (
              <Avatar avatar="☁️" size={40} style={{ borderRadius: 8 }} />
            )}
            <Flexbox flex={1} gap={4}>
              <Flexbox horizontal align="center" gap={8}>
                <span style={{ fontWeight: 600 }}>{klavisTypeInfo?.label || identifier}</span>
                <span style={{ color: 'var(--lobe-text-tertiary)', fontSize: 12 }}>Klavis</span>
              </Flexbox>
              <span style={{ color: 'var(--lobe-text-secondary)', fontSize: 12 }}>
                {isPendingAuth
                  ? t('agentBuilder.installPlugin.requiresAuth')
                  : t('agentBuilder.installPlugin.clickApproveToConnect')}
              </span>
            </Flexbox>
          </Flexbox>
        </Flexbox>
      );
    }

    // Render LobehubSkill provider
    if (isLobehubSkill) {
      const icon =
        typeof lobehubSkillProviderInfo?.icon === 'string'
          ? lobehubSkillProviderInfo.icon
          : undefined;
      const isNotConnected =
        !lobehubSkillServer || lobehubSkillServer.status !== LobehubSkillStatus.CONNECTED;

      return (
        <Flexbox
          gap={12}
          style={{ background: 'var(--lobe-fill-tertiary)', borderRadius: 8, padding: 16 }}
        >
          <Flexbox horizontal align="center" gap={12}>
            {icon ? (
              <Image
                unoptimized
                alt={lobehubSkillProviderInfo?.label || identifier}
                height={40}
                src={icon}
                style={{ borderRadius: 8 }}
                width={40}
              />
            ) : (
              <Avatar avatar="🔗" size={40} style={{ borderRadius: 8 }} />
            )}
            <Flexbox flex={1} gap={4}>
              <Flexbox horizontal align="center" gap={8}>
                <span style={{ fontWeight: 600 }}>
                  {lobehubSkillProviderInfo?.label || identifier}
                </span>
                <span style={{ color: 'var(--lobe-text-tertiary)', fontSize: 12 }}>
                  LobeHub Skill
                </span>
              </Flexbox>
              <span style={{ color: 'var(--lobe-text-secondary)', fontSize: 12 }}>
                {isNotConnected
                  ? t('agentBuilder.installPlugin.requiresAuth')
                  : t('agentBuilder.installPlugin.clickApproveToConnect')}
              </span>
            </Flexbox>
          </Flexbox>
        </Flexbox>
      );
    }

    // Render MCP marketplace plugin or Builtin tool
    // Note: The actual installation happens in ExecutionRuntime after user approves
    const pluginName = marketPlugin?.name || builtinTool?.manifest?.meta?.title || identifier;
    const pluginIcon = marketPlugin?.icon || builtinTool?.manifest?.meta?.avatar;
    const pluginType = source === 'market' ? 'MCP Plugin' : 'Builtin Tool';

    return (
      <Flexbox
        gap={12}
        style={{ background: 'var(--lobe-fill-tertiary)', borderRadius: 8, padding: 16 }}
      >
        <Flexbox horizontal align="center" gap={12}>
          {pluginIcon && typeof pluginIcon === 'string' && pluginIcon.startsWith('http') ? (
            <Image
              unoptimized
              alt={pluginName}
              height={40}
              src={pluginIcon}
              style={{ borderRadius: 8 }}
              width={40}
            />
          ) : (
            <Avatar avatar={pluginIcon || '🔧'} size={40} style={{ borderRadius: 8 }} />
          )}
          <Flexbox flex={1} gap={4}>
            <Flexbox horizontal align="center" gap={8}>
              <span style={{ fontWeight: 600 }}>{pluginName}</span>
              <span style={{ color: 'var(--lobe-text-tertiary)', fontSize: 12 }}>{pluginType}</span>
            </Flexbox>
            <span style={{ color: 'var(--lobe-text-secondary)', fontSize: 12 }}>
              {t('agentBuilder.installPlugin.clickApproveToInstall')}
            </span>
          </Flexbox>
        </Flexbox>
      </Flexbox>
    );
  },
);

export default InstallPluginIntervention;
