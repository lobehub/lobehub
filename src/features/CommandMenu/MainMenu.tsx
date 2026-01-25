import { SOCIAL_URL } from '@lobechat/business-const';
import { DiscordIcon } from '@lobehub/ui/icons';
import { Command } from 'cmdk';
import {
  Bot,
  FeatherIcon,
  FilePen,
  Github,
  LibraryBig,
  MessageSquarePlusIcon,
  Monitor,
  Star,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { getNavigableRoutes, getRouteById } from '@/config/routes';
import { FEEDBACK } from '@/const/url';
import { useFeedbackModal } from '@/hooks/useFeedbackModal';

import { useCommandMenuContext } from './CommandMenuContext';
import ContextCommands from './ContextCommands';
import { CommandItem } from './components';
import { useCommandMenu } from './useCommandMenu';

const MainMenu = memo(() => {
  const { pathname, menuContext, setPages, pages } = useCommandMenuContext();
  const { t } = useTranslation('common');
  const { open: openFeedbackModal } = useFeedbackModal();

  const {
    handleCreateSession,
    handleCreateTopic,
    handleCreateLibrary,
    handleCreatePage,
    handleNavigate,
    handleExternalLink,
    handleCreateAgentTeam,
  } = useCommandMenu();

  return (
    <>
      <ContextCommands />

      <Command.Group>
        <CommandItem
          icon={<Bot />}
          onSelect={handleCreateSession}
          unpinned={menuContext === 'agent' || menuContext === 'page'}
          value="create new agent assistant"
        >
          {t('cmdk.newAgent')}
        </CommandItem>

        <CommandItem
          icon={<Bot />}
          onSelect={handleCreateAgentTeam}
          unpinned={menuContext === 'agent' || menuContext === 'page'}
          value="create new agent team"
        >
          {t('cmdk.newAgentTeam')}
        </CommandItem>

        {menuContext === 'agent' && (
          <CommandItem
            icon={<MessageSquarePlusIcon />}
            onSelect={handleCreateTopic}
            unpinned={menuContext !== 'agent'}
            value="create new topic"
          >
            {t('cmdk.newTopic')}
          </CommandItem>
        )}

        <CommandItem icon={<FilePen />} onSelect={handleCreatePage} value="create new page">
          {t('cmdk.newPage')}
        </CommandItem>

        <CommandItem
          icon={<LibraryBig />}
          onSelect={handleCreateLibrary}
          unpinned={menuContext !== 'resource'}
          value="create new library"
        >
          {t('cmdk.newLibrary')}
        </CommandItem>

        {menuContext !== 'settings' &&
          (() => {
            const settingsRoute = getRouteById('settings');
            const SettingsIcon = settingsRoute?.icon;
            const keywords = settingsRoute?.keywordsKey
              ? t(settingsRoute.keywordsKey as any).split(' ')
              : settingsRoute?.keywords;
            return (
              <CommandItem
                icon={SettingsIcon && <SettingsIcon />}
                keywords={keywords}
                onSelect={() => handleNavigate(settingsRoute?.path || '/settings')}
                value="settings"
              >
                {t('cmdk.settings')}
              </CommandItem>
            );
          })()}

        <CommandItem
          icon={<Monitor />}
          onSelect={() => setPages([...pages, 'theme'])}
          value="theme"
        >
          {t('cmdk.theme')}
        </CommandItem>
      </Command.Group>

      <Command.Group heading={t('cmdk.navigate')}>
        {getNavigableRoutes().map((route) => {
          const RouteIcon = route.icon;
          const keywords = route.keywordsKey
            ? t(route.keywordsKey as any).split(' ')
            : route.keywords;
          return (
            !pathname?.startsWith(route.pathPrefix) && (
              <CommandItem
                icon={<RouteIcon />}
                key={route.id}
                keywords={keywords}
                onSelect={() => handleNavigate(route.path)}
                value={route.id}
              >
                {t(route.cmdkKey as any)}
              </CommandItem>
            )
          );
        })}
      </Command.Group>

      <Command.Group heading={t('cmdk.about')}>
        <CommandItem
          icon={<FeatherIcon />}
          keywords={t('cmdk.keywords.contactUs').split(' ')}
          onSelect={openFeedbackModal}
          value="contact-via-email"
        >
          {t('cmdk.contactUs')}
        </CommandItem>
        <CommandItem
          icon={<Github />}
          keywords={t('cmdk.keywords.submitIssue').split(' ')}
          onSelect={() => handleExternalLink(FEEDBACK)}
          value="submit-issue"
        >
          {t('cmdk.submitIssue')}
        </CommandItem>
        <CommandItem
          icon={<Star />}
          keywords={t('cmdk.keywords.starGitHub').split(' ')}
          onSelect={() => handleExternalLink(SOCIAL_URL.github)}
          value="star-github"
        >
          {t('cmdk.starOnGitHub')}
        </CommandItem>
        <CommandItem
          icon={<DiscordIcon />}
          keywords={t('cmdk.keywords.discord').split(' ')}
          onSelect={() => handleExternalLink(SOCIAL_URL.discord)}
          value="discord"
        >
          {t('cmdk.communitySupport')}
        </CommandItem>
      </Command.Group>
    </>
  );
});

MainMenu.displayName = 'MainMenu';

export default MainMenu;
