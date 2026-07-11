import { useMemo } from 'react';

import { buildTelegramDeepLink } from '@/features/Messenger/constants';
import { useClientDataSWR } from '@/libs/swr';
import { messengerKeys } from '@/libs/swr/keys';
import { messengerService } from '@/services/messenger';

type AvailablePlatform = Awaited<ReturnType<typeof messengerService.availablePlatforms>>[number];
type Installation = Awaited<ReturnType<typeof messengerService.listMyInstallations>>[number];
type Link = Awaited<ReturnType<typeof messengerService.listMyLinks>>[number];

export type MessengerPlatformId = 'slack' | 'telegram' | 'discord';

export interface MessengerPlatformRow {
  connected: boolean;
  href?: string;
  id: MessengerPlatformId;
}

const SLACK_INSTALL_HREF = '/api/agent/messenger/slack/install';
const DISCORD_INSTALL_HREF = '/api/agent/messenger/discord/install';

export const PLATFORM_ORDER: MessengerPlatformId[] = ['slack', 'telegram', 'discord'];

export const buildMessengerPlatformRows = (
  platforms: AvailablePlatform[] | undefined,
  installations: Installation[] | undefined,
  links: Link[] | undefined,
): MessengerPlatformRow[] => {
  const byId = new Map((platforms ?? []).map((platform) => [platform.id, platform]));
  const connectedPlatformIds = new Set<string>([
    ...(installations ?? []).map((installation) => installation.platform),
    ...(links ?? []).map((link) => link.platform),
  ]);

  return PLATFORM_ORDER.filter((id) => byId.has(id)).map((id) => {
    const platform = byId.get(id);
    const href =
      id === 'slack'
        ? SLACK_INSTALL_HREF
        : id === 'discord'
          ? DISCORD_INSTALL_HREF
          : platform && 'botUsername' in platform && platform.botUsername
            ? buildTelegramDeepLink(platform.botUsername)
            : undefined;

    return { connected: connectedPlatformIds.has(id), href, id };
  });
};

export const resolveMessengerPlatformsLoading = (
  isLoadingPlatforms: boolean,
  isLoadingInstallations: boolean,
  isLoadingLinks: boolean,
): boolean => isLoadingPlatforms || isLoadingInstallations || isLoadingLinks;

export const useMessengerPlatforms = () => {
  const { data: platforms, isLoading: isLoadingPlatforms } = useClientDataSWR(
    messengerKeys.availablePlatforms(),
    () => messengerService.availablePlatforms(),
  );
  const { data: installations, isLoading: isLoadingInstallations } = useClientDataSWR(
    messengerKeys.listMyInstallations(),
    () => messengerService.listMyInstallations(),
  );
  const { data: links, isLoading: isLoadingLinks } = useClientDataSWR(
    messengerKeys.listMyLinks(),
    () => messengerService.listMyLinks(),
  );

  const rows = useMemo(
    () => buildMessengerPlatformRows(platforms, installations, links),
    [platforms, installations, links],
  );

  const isLoading = resolveMessengerPlatformsLoading(
    isLoadingPlatforms,
    isLoadingInstallations,
    isLoadingLinks,
  );

  return { isLoading, rows };
};
