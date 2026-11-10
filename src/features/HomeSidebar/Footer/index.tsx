'use client';

import { SOCIAL_URL } from '@lobechat/business-const';
import { type DropdownItem } from '@lobehub/ui';
import { ActionIcon, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
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
import { useHelpMenuBugReportItem } from '@/business/client/hooks/useHelpMenuBugReportItem';
import { openChangelogModal } from '@/components/ChangelogModal';
import { openFeedbackModal } from '@/components/FeedbackModal';
import { DOCUMENTS_REFER_URL, GITHUB } from '@/const/url';
import Billboard from '@/features/Billboard';
import { useBillboardMenuItems } from '@/features/Billboard/MenuItems';
import { useActiveNavKey } from '@/features/NavPanel/useActiveNavKey';
import ThemeButton from '@/features/User/UserPanel/ThemeButton';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useNavLayout } from '@/hooks/useNavLayout';
import { useAnalytics } from '@/libs/analytics/client';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/slices/preference/selectors/labPrefer';
import { userGeneralSettingsSelectors } from '@/store/user/slices/settings/selectors/general';

type FooterMenuItems = NonNullable<DropdownItem[]>;

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
  const enableBugReport = useUserStore(labPreferSelectors.enableTopicBugReport);
  const bugReportItem = useHelpMenuBugReportItem();

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
    helpMenuItems: DropdownItem[];
    trackedMenuKeys: string[];
  }>(() => {
    const settingsGroup: FooterMenuItems =
      footer.showSettingsEntry && !isDevMode
        ? [
            {
              icon: <Icon icon={Settings2} />,
              key: 'setting',
              label: <WorkspaceLink to="/settings">{t(settingLabelKey)}</WorkspaceLink>,
            },
          ]
        : [];
    const inviteGroup: FooterMenuItems = enableBusinessFeatures
      ? [
          {
            icon: <Icon icon={Send} />,
            key: 'inviteFriend',
            label: (
              <WorkspaceLink to="/settings/referral">{t('userPanel.inviteFriend')}</WorkspaceLink>
            ),
          },
        ]
      : [];
    // Getting help: read the docs, report what broke, or reach a person.
    const helpGroup: FooterMenuItems = [
      {
        icon: <Icon icon={Book} />,
        key: 'docs',
        label: (
          <a href={DOCUMENTS_REFER_URL} rel="noopener noreferrer" target="_blank">
            {t('userPanel.docs')}
          </a>
        ),
      },
      ...(enableBugReport && bugReportItem ? [bugReportItem] : []),
      {
        icon: <Icon icon={Feather} />,
        key: 'feedback',
        label: t('userPanel.feedback'),
        onClick: handleOpenFeedbackModal,
      },
    ];
    const productGroup: FooterMenuItems = [
      {
        icon: <Icon icon={FileClockIcon} />,
        key: 'changelog',
        label: t('changelog'),
        onClick: handleOpenChangelogModal,
      },
      ...(footer.layout === 'compact'
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
    const communityGroup: FooterMenuItems = [
      {
        icon: <Icon icon={DiscordIcon} />,
        key: 'discord',
        label: (
          <a href={SOCIAL_URL.discord} rel="noopener noreferrer" target="_blank">
            {t('userPanel.discord')}
          </a>
        ),
      },
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
    ];
    // A divider only between groups that have items, never at an edge or doubled.
    const ownItems: FooterMenuItems = [
      settingsGroup,
      inviteGroup,
      helpGroup,
      productGroup,
      communityGroup,
    ]
      .filter((group) => group.length > 0)
      .flatMap((group, index) => (index === 0 ? group : [{ type: 'divider' as const }, ...group]));

    return {
      helpMenuItems: [
        ...injectMenuTracking(ownItems, trackMenuClick),
        ...(isHomeSidebar && billboardMenuItems && billboardMenuItems.length > 0
          ? [{ type: 'divider' as const }, ...billboardMenuItems]
          : []),
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
    enableBugReport,
    bugReportItem,
    handleOpenChangelogModal,
    handleOpenFeedbackModal,
    isDevMode,
    t,
    settingLabelKey,
    billboardMenuItems,
    isHomeSidebar,
  ]);

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
            {!footer.hideGitHub && (
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
          <DropdownMenu
            items={helpMenuItems}
            placement="topLeft"
            onOpenChange={handleMenuOpenChange}
          >
            <ActionIcon aria-label={t('userPanel.help')} icon={CircleHelp} size={16} />
          </DropdownMenu>
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
