'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { type ItemType } from 'antd/es/menu/interface';
import { cssVar } from 'antd-style';
import { SendIcon, Settings2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { messengerKeys } from '@/libs/swr/keys';
import { messengerService } from '@/services/messenger';

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
 * SWR dedupes the fetches across every row that renders this hook, so a long
 * file list still issues a single request each.
 */
export const useSendToMessengerMenuItem = ({
  enabled,
  file,
}: UseSendToMessengerMenuItemParams): ItemType | null => {
  const { t } = useTranslation(['components', 'common']);
  const navigate = useWorkspaceAwareNavigate();

  const platformsSWR = useSWR(
    enabled ? messengerKeys.availablePlatforms() : null,
    () => messengerService.availablePlatforms(),
    { revalidateOnFocus: false },
  );
  const linksSWR = useSWR(
    enabled ? messengerKeys.listMyLinks() : null,
    () => messengerService.listMyLinks(),
    { revalidateOnFocus: false },
  );
  const platforms = platformsSWR.data;
  const links = linksSWR.data;

  // Slack links carry a workspace tenant; resolve its display name from the
  // caller's installations. Only fetched when a Slack link actually exists.
  const hasSlackLink = !!links?.some((link) => link.platform === 'slack');
  const installationsSWR = useSWR(
    hasSlackLink ? messengerKeys.listMyInstallations() : null,
    () => messengerService.listMyInstallations(),
    { revalidateOnFocus: false },
  );
  const tenantNameByTenantId = new Map(
    (installationsSWR.data ?? []).map((i) => [i.tenantId, i.tenantName]),
  );

  if (!enabled) return null;

  let children: ItemType[];

  if (platforms === undefined || links === undefined) {
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
