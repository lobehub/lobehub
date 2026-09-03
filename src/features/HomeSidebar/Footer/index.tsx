'use client';

import { DESKTOP_APP_ENABLED, FOOTER_HIDDEN_MENU_KEYS, SOCIAL_URL } from '@lobechat/business-const';
import { useAnalytics } from '@lobehub/analytics/react';
import { type MenuProps } from '@lobehub/ui';
import { DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { DiscordIcon, GithubIcon } from '@lobehub/ui/icons';
import {
  Book,
  CircleHelp,
  Download,
  Feather,
  FileClockIcon,
  FlaskConical,
  Send,
  Settings2,
  SettingsIcon,
} from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useHasActiveWorkspace } from '@/business/client/hooks/useHasActiveWorkspace';
import { openChangelogModal } from '@/components/ChangelogModal';
import { openFeedbackModal } from '@/components/FeedbackModal';
import { DOCUMENTS_REFER_URL, GITHUB } from '@/const/url';
import Billboard from '@/features/Billboard';
import { useBillboardMenuItems } from '@/features/Billboard/MenuItems';
import { useActiveNavKey } from '@/features/NavPanel/useActiveNavKey';
import ThemeButton from '@/features/User/UserPanel/ThemeButton';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useNavLayout } from '@/hooks/useNavLayout';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/slices/settings/selectors/general';

type FooterMenuItems = NonNullable<MenuProps['items']>;

/**
 * Wrap each clickable menu item with a unified click tracker, preserving any
 * existing onClick. Skips dividers and items without a key. Used to measure
 * which footer menu entries get clicked (breakdown by `key`).
 */
const injectMenuTracking = (
  items: FooterMenuItems,
  track: (key: string) => void,
): FooterMenuItems =>
  items.map((item) => {
    if (!item || (item as { type?: string }).type === 'divider') return item;
    const key = (item as { key?: string | number }).key;
    if (!key) return item;
    const originalOnClick = (item as { onClick?: (info: unknown) => void }).onClick;
    return {
      ...item,
      onClick: (info: unknown) => {
        track(String(key));
        originalOnClick?.(info);
      },
    };
  });

/**
 * Collect the keys of click-trackable items — the exact same set wrapped by
 * `injectMenuTracking` (non-divider items with a key). Used so the menu-open
 * exposure event reports only keys that can later emit `home_footer_menu_clicked`,
 * keeping per-key CTR denominators and numerators aligned. Billboard items are
 * excluded here (they emit their own `billboard_*` events).
 */
const collectMenuKeys = (items: FooterMenuItems): string[] =>
  items
    .filter((item) => item && (item as { type?: string }).type !== 'divider')
    .map((item) => (item as { key?: string | number }).key)
    .filter((key): key is string | number => Boolean(key))
    .map(String);

const isDivider = (item: FooterMenuItems[number]) =>
  !item || (item as { type?: string }).type === 'divider';

/**
 * Drop the entries this distribution hides, then repair the separators they
 * leave behind.
 *
 * The dividers are positional — they were written to sit between groups that
 * exist upstream — so removing entries strands them: two hidden neighbours
 * collapse into a double rule, and hiding a trailing group leaves a line under
 * the last item with nothing after it. Both read as a menu that failed to
 * render rather than one that is deliberately short.
 */
const applyHiddenKeys = (items: FooterMenuItems): FooterMenuItems => {
  if (FOOTER_HIDDEN_MENU_KEYS.length === 0) return items;

  const kept = items.filter((item) => {
    if (isDivider(item)) return true;
    const key = (item as { key?: string | number }).key;
    return !key || !FOOTER_HIDDEN_MENU_KEYS.includes(String(key));
  });

  return kept.filter((item, index) => {
    if (!isDivider(item)) return true;
    // Leading, trailing, or doubled-up: a divider only earns its place with a
    // surviving entry on both sides of it.
    const hasEntryBefore = kept.slice(0, index).some((other) => !isDivider(other));
    const hasEntryAfter = kept.slice(index + 1).some((other) => !isDivider(other));
    const isFirstOfRun = index === 0 || !isDivider(kept[index - 1]);
    return hasEntryBefore && hasEntryAfter && isFirstOfRun;
  });
};

const Footer = memo(() => {
  const { t } = useTranslation('common');
  const { analytics } = useAnalytics();
  const { footer } = useNavLayout();
  const hasActiveWorkspace = useHasActiveWorkspace();
  const settingLabelKey = hasActiveWorkspace ? 'userPanel.workspaceSetting' : 'userPanel.setting';
  const activeNavKey = useActiveNavKey();
  const isHomeSidebar = activeNavKey === 'home';
  const billboardMenuItems = useBillboardMenuItems();
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);

  const trackMenuClick = useCallback(
    (key: string) => {
      try {
        analytics?.track({
          name: 'home_footer_menu_clicked',
          properties: { key, spm: `homepage.footer.${key}.clicked` },
        });
      } catch {
        // silently ignore tracking errors to avoid affecting business logic
      }
    },
    [analytics],
  );

  const handleOpenChangelogModal = useCallback(() => {
    openChangelogModal();
  }, []);

  const handleOpenFeedbackModal = useCallback(() => {
    openFeedbackModal();
  }, []);

  const { helpMenuItems, trackedMenuKeys } = useMemo<{
    helpMenuItems: MenuProps['items'];
    trackedMenuKeys: string[];
  }>(() => {
    const allItems: FooterMenuItems = [
      ...(footer.showSettingsEntry && !isDevMode
        ? [
            {
              icon: <Icon icon={Settings2} />,
              key: 'setting',
              label: <WorkspaceLink to="/settings">{t(settingLabelKey)}</WorkspaceLink>,
            },
            {
              type: 'divider' as const,
            },
          ]
        : []),
      ...(enableBusinessFeatures
        ? [
            {
              icon: <Icon icon={Send} />,
              key: 'inviteFriend',
              label: (
                <WorkspaceLink to="/settings/referral">{t('userPanel.inviteFriend')}</WorkspaceLink>
              ),
            },
          ]
        : []),
      {
        icon: <Icon icon={Book} />,
        key: 'docs',
        label: (
          <a href={DOCUMENTS_REFER_URL} rel="noopener noreferrer" target="_blank">
            {t('userPanel.docs')}
          </a>
        ),
      },
      {
        icon: <Icon icon={Feather} />,
        key: 'feedback',
        label: t('userPanel.feedback'),
        onClick: handleOpenFeedbackModal,
      },
      {
        icon: <Icon icon={DiscordIcon} />,
        key: 'discord',
        label: (
          <a href={SOCIAL_URL.discord} rel="noopener noreferrer" target="_blank">
            {t('userPanel.discord')}
          </a>
        ),
      },
      {
        type: 'divider',
      },
      {
        icon: <Icon icon={FileClockIcon} />,
        key: 'changelog',
        label: t('changelog'),
        onClick: handleOpenChangelogModal,
      },
      ...(DESKTOP_APP_ENABLED && footer.layout === 'compact'
        ? [
            {
              icon: <Icon icon={Download} />,
              key: 'get-app',
              label: (
                <WorkspaceLink escape to="/apps">
                  {t('getApp')}
                </WorkspaceLink>
              ),
            },
          ]
        : []),
      ...(footer.layout === 'compact' && !footer.hideGitHub
        ? [
            {
              icon: <Icon icon={GithubIcon} />,
              key: 'github',
              label: (
                <a href={GITHUB} rel="noopener noreferrer" target="_blank">
                  GitHub
                </a>
              ),
            },
          ]
        : []),
      ...(footer.showEvalEntry && footer.layout === 'compact'
        ? [
            {
              icon: <Icon icon={FlaskConical} />,
              key: 'eval',
              label: <WorkspaceLink to="/eval">Evaluation Lab</WorkspaceLink>,
            },
          ]
        : []),
    ];

    const ownItems = applyHiddenKeys(allItems);
    const billboardItems =
      isHomeSidebar && billboardMenuItems && billboardMenuItems.length > 0
        ? billboardMenuItems
        : [];

    return {
      helpMenuItems: [
        ...injectMenuTracking(ownItems, trackMenuClick),
        // The separator belongs between the two groups, so it is only earned
        // once there is something above it to separate from.
        ...(billboardItems.length > 0 && ownItems.length > 0 ? [{ type: 'divider' as const }] : []),
        ...billboardItems,
      ],
      trackedMenuKeys: collectMenuKeys(ownItems),
    };
  }, [
    trackMenuClick,
    footer.showSettingsEntry,
    footer.layout,
    footer.hideGitHub,
    footer.showEvalEntry,
    enableBusinessFeatures,
    handleOpenChangelogModal,
    handleOpenFeedbackModal,
    isDevMode,
    t,
    settingLabelKey,
    billboardMenuItems,
    isHomeSidebar,
  ]);

  /**
   * A distribution can hide every entry the menu would have held — and the
   * remaining `setting` entry is itself conditional, since a dev-mode user gets
   * a dedicated settings button beside this one instead. Both together leave the
   * trigger opening an empty popover, which reads as a menu that failed to load.
   * Drop the trigger rather than the contents.
   */
  const hasHelpMenu = (helpMenuItems?.length ?? 0) > 0;

  const handleMenuOpenChange = useCallback(
    (open: boolean) => {
      if (!open) return;
      try {
        analytics?.track({
          name: 'home_footer_menu_opened',
          properties: { keys: trackedMenuKeys.join(','), spm: 'homepage.footer.opened' },
        });
      } catch {
        // silently ignore tracking errors to avoid affecting business logic
      }
    },
    [analytics, trackedMenuKeys],
  );

  return (
    <>
      {footer.layout === 'expanded' ? (
        <Flexbox horizontal align={'center'} gap={2} justify={'space-between'} padding={8}>
          <Flexbox horizontal align={'center'} flex={1} gap={2}>
            {hasHelpMenu && (
              <DropdownMenu
                items={helpMenuItems}
                placement="topLeft"
                onOpenChange={handleMenuOpenChange}
              >
                <ActionIcon
                  aria-label={t('userPanel.help')}
                  data-billboard-anchor=""
                  icon={CircleHelp}
                  size={16}
                />
              </DropdownMenu>
            )}
            {!footer.hideGitHub && !FOOTER_HIDDEN_MENU_KEYS.includes('github') && (
              <a aria-label={'GitHub'} href={GITHUB} rel="noopener noreferrer" target={'_blank'}>
                <ActionIcon icon={GithubIcon} size={16} title={'GitHub'} />
              </a>
            )}
            <WorkspaceLink to="/eval">
              <ActionIcon icon={FlaskConical} size={16} title="Evaluation Lab" />
            </WorkspaceLink>
          </Flexbox>
          <ThemeButton placement={'topCenter'} size={16} />
        </Flexbox>
      ) : (
        <Flexbox horizontal align={'center'} gap={2} padding={8}>
          {hasHelpMenu && (
            <DropdownMenu
              items={helpMenuItems}
              placement="topLeft"
              onOpenChange={handleMenuOpenChange}
            >
              <ActionIcon aria-label={t('userPanel.help')} icon={CircleHelp} size={16} />
            </DropdownMenu>
          )}
          {isDevMode && (
            <WorkspaceLink to="/settings">
              <ActionIcon
                aria-label={t(settingLabelKey)}
                icon={SettingsIcon}
                size={16}
                title={t(settingLabelKey)}
              />
            </WorkspaceLink>
          )}
        </Flexbox>
      )}
      {isHomeSidebar && <Billboard />}
    </>
  );
});

export default Footer;
