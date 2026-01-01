'use client';

import { KLAVIS_SERVER_TYPES } from '@lobechat/const';
import { BuiltinInterventionProps } from '@lobechat/types';
import { Avatar , Flexbox } from '@lobehub/ui';
import { CheckCircle } from 'lucide-react';
import Image from 'next/image';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import { klavisStoreSelectors, pluginSelectors } from '@/store/tool/selectors';
import { KlavisServerStatus } from '@/store/tool/slices/klavisStore/types';

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

    // Check if it's a Klavis tool
    const klavisTypeInfo = KLAVIS_SERVER_TYPES.find((t) => t.identifier === identifier);
    const isKlavis = source === 'official' && !!klavisTypeInfo;

    // Render success state (already installed)
    if (isPluginInstalled) {
      return (
        <Flexbox
          align="center"
          gap={12}
          horizontal
          style={{
            background: 'var(--lobe-fill-tertiary)',
            borderRadius: 8,
            padding: 16,
          }}
        >
          <CheckCircle size={20} style={{ color: 'var(--lobe-success-6)' }} />
          <Flexbox gap={4}>
            <span style={{ fontWeight: 600 }}>
              {isKlavis
                ? t('agentBuilder.installPlugin.connectedAndEnabled')
                : t('agentBuilder.installPlugin.installedAndEnabled')}
            </span>
            <span style={{ color: 'var(--lobe-text-secondary)', fontSize: 12 }}>
              {klavisTypeInfo?.label || identifier}
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
          <Flexbox align="center" gap={12} horizontal>
            {icon ? (
              <Image
                alt={klavisTypeInfo?.label || identifier}
                height={40}
                src={icon}
                style={{ borderRadius: 8 }}
                unoptimized
                width={40}
              />
            ) : (
              <Avatar avatar="☁️" size={40} style={{ borderRadius: 8 }} />
            )}
            <Flexbox flex={1} gap={4}>
              <Flexbox align="center" gap={8} horizontal>
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

    // Render MCP marketplace plugin
    // Note: The actual installation happens in ExecutionRuntime after user approves
    return (
      <Flexbox
        gap={12}
        style={{ background: 'var(--lobe-fill-tertiary)', borderRadius: 8, padding: 16 }}
      >
        <Flexbox align="center" gap={12} horizontal>
          <Avatar avatar="🔧" size={40} style={{ borderRadius: 8 }} />
          <Flexbox flex={1} gap={4}>
            <Flexbox align="center" gap={8} horizontal>
              <span style={{ fontWeight: 600 }}>{identifier}</span>
              <span style={{ color: 'var(--lobe-text-tertiary)', fontSize: 12 }}>MCP Plugin</span>
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
