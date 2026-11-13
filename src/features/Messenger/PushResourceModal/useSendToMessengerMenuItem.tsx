'use client';

import type { ItemType } from '@lobehub/ui';
import { cssVar, Flexbox, Icon } from '@lobehub/ui';
import { SendIcon, Settings2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { messengerActions, messengerSelectors, useMessengerStore } from '@/store/messenger';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import {
  type MessengerPlatform,
  PlatformBrandIcon,
  SUPPORTED_MESSENGER_PLATFORMS,
} from '../constants';
import { openPushResourceModal } from './index';
import type { PushResourceFile } from './PushResourceContent';

const platformNameById = new Map<string, string>(
  SUPPORTED_MESSENGER_PLATFORMS.map((p) => [p.id, p.name]),
);

interface UseSendToMessengerMenuItemParams {
  enabled: boolean;
  file: PushResourceFile;
}

/**
 * "Send to Messenger" entry for the resource row menu: a hover submenu with
 * one entry per available platform. A linked platform opens the push modal
 * (one entry per platform × Slack workspace); an unlinked one deep-links to
 * that platform's messenger settings page for setup.
 *
 * The messenger store dedupes the reads across every row that renders this
 * hook, so a long file list still issues a single request each, and a reload
 * paints the submenu from the local copy.
 */
export const useSendToMessengerMenuItem = ({
  enabled,
  file,
}: UseSendToMessengerMenuItemParams): ItemType | null => {
  const { t } = useTranslation(['components', 'common']);
  const navigate = useWorkspaceAwareNavigate();
  // Messenger bots only exist on business deployments; elsewhere the entry
  // would lead to a settings page that is hidden.
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const active = enabled && enableBusinessFeatures;

  messengerActions.useFetchPlatforms({ enabled: active, revalidateOnFocus: false });
  messengerActions.useFetchLinks({ enabled: active, revalidateOnFocus: false });
  const platforms = useMessengerStore(messengerSelectors.platforms);
  const links = useMessengerStore(messengerSelectors.links);
  // An empty restored list may predate a new link: it is still loading, so the
  // submenu does not offer "Set Up" for a platform that is already linked.
  const isSettled = useMessengerStore(
    (s) => messengerSelectors.isPlatformsSettled(s) && messengerSelectors.isLinksSettled(s),
  );

  // Slack links carry a workspace tenant; resolve its display name from the
  // caller's installations. Only fetched when a Slack link actually exists.
  const hasSlackLink = !!links?.some((link) => link.platform === 'slack');
  messengerActions.useFetchInstallations({
    enabled: active && hasSlackLink,
    revalidateOnFocus: false,
  });
  const installations = useMessengerStore(messengerSelectors.installations);
  const tenantNameByTenantId = new Map(
    (installations ?? []).map((i) => [i.tenantId, i.tenantName]),
  );

  if (!active) return null;

  let children: ItemType[];

  if (!isSettled || platforms === undefined || links === undefined) {
    children = [
      {
        disabled: true,
        key: 'send-to-messenger-loading',
        label: t('loading', { ns: 'common' }),
      },
    ];
  } else {
    // Keep the registry order stable regardless of what the queries return.
    const availableIds = SUPPORTED_MESSENGER_PLATFORMS.map((p) => p.id).filter((id) =>
      platforms.some((p) => p.id === id),
    );

    children = availableIds.flatMap((platform): ItemType[] => {
      const platformName = platformNameById.get(platform) ?? platform;
      const platformLinks = links.filter((link) => link.platform === platform);

      // Unlinked platform: grayed-out name with a trailing "Set Up" action;
      // the whole row deep-links to that platform's setup page.
      if (platformLinks.length === 0) {
        return [
          {
            icon: <PlatformBrandIcon platform={platform} size={16} />,
            key: `send-to-messenger-setup-${platform}`,
            label: (
              <Flexbox horizontal align="center" flex={1} gap={16} justify="space-between">
                <span style={{ color: cssVar.colorTextTertiary }}>{platformName}</span>
                <span style={{ color: cssVar.colorTextSecondary, fontSize: 12 }}>
                  {t('FileManager.actions.sendToMessengerSetupAction')}
                </span>
              </Flexbox>
            ),
            onClick: ({ domEvent }) => {
              domEvent.stopPropagation();
              navigate(`/settings/messenger/${platform}`);
            },
          },
        ];
      }

      // Linked: a single entry per platform. Slack workspace selection happens
      // inside the modal (a target select, mirroring the settings push card),
      // so multiple workspace links do not multiply the submenu.
      const targets =
        platform === 'slack'
          ? platformLinks
              .filter((link) => link.tenantId)
              .map((link) => ({
                label: tenantNameByTenantId.get(link.tenantId) ?? link.tenantId,
                tenantId: link.tenantId,
              }))
          : undefined;

      return [
        {
          icon: <PlatformBrandIcon platform={platform} size={16} />,
          key: `send-to-messenger-${platform}`,
          label: platformName,
          onClick: ({ domEvent }) => {
            domEvent.stopPropagation();
            openPushResourceModal({
              file,
              platform: platform as MessengerPlatform,
              platformName,
              targets,
            });
          },
        },
      ];
    });

    // Deployment has no messenger platform configured at all: fall back to a
    // single entry pointing at the messenger settings overview.
    if (children.length === 0) {
      children = [
        {
          icon: <Icon icon={Settings2Icon} />,
          key: 'send-to-messenger-setup',
          label: t('FileManager.actions.sendToMessengerSetup'),
          onClick: ({ domEvent }) => {
            domEvent.stopPropagation();
            navigate('/settings/messenger');
          },
        },
      ];
    } else {
      // Trailing shortcut to the messenger settings overview.
      children.push(
        { type: 'divider' },
        {
          icon: <Icon icon={Settings2Icon} />,
          key: 'send-to-messenger-settings',
          label: t('FileManager.actions.sendToMessengerSettings'),
          onClick: ({ domEvent }) => {
            domEvent.stopPropagation();
            navigate('/settings/messenger');
          },
        },
      );
    }
  }

  return {
    children,
    icon: <Icon icon={SendIcon} />,
    key: 'sendToMessenger',
    label: t('FileManager.actions.sendToMessenger'),
  };
};
