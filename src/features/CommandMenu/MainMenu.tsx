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
import { CommandItem } from './components';
import ContextCommands from './ContextCommands';
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
          unpinned={menuContext === 'agent' || menuContext === 'page'}
          value="create new agent assistant"
          onSelect={handleCreateSession}
        >
          {t('cmdk.newAgent')}
        </CommandItem>

        <CommandItem
          icon={<Bot />}
          unpinned={menuContext === 'agent' || menuContext === 'page'}
          value="create new agent team"
          onSelect={handleCreateAgentTeam}
        >
          {t('cmdk.newAgentTeam')}
        </CommandItem>

        {menuContext === 'agent' && (
          <CommandItem
            icon={<MessageSquarePlusIcon />}
            unpinned={menuContext !== 'agent'}
            value="create new topic"
            onSelect={handleCreateTopic}
          >
            {t('cmdk.newTopic')}
          </CommandItem>
        )}

        <CommandItem icon={<FilePen />} value="create new page" onSelect={handleCreatePage}>
          {t('cmdk.newPage')}
        </CommandItem>

        <CommandItem
          icon={<LibraryBig />}
          unpinned={menuContext !== 'resource'}
          value="create new library"
          onSelect={handleCreateLibrary}
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
                value="settings"
                onSelect={() => handleNavigate(settingsRoute?.path || '/settings')}
              >
                {t('cmdk.settings')}
              </CommandItem>
            );
          })()}

        <CommandItem
          icon={<Monitor />}
          value="theme"
          onSelect={() => setPages([...pages, 'theme'])}
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
                value={route.id}
                onSelect={() => handleNavigate(route.path)}
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
          value="contact-via-email"
          onSelect={() => openFeedbackModal()}
        >
          {t('cmdk.contactUs')}
        </CommandItem>
        <CommandItem
          icon={<Github />}
          keywords={t('cmdk.keywords.submitIssue').split(' ')}
          value="submit-issue"
          onSelect={() => handleExternalLink(FEEDBACK)}
        >
          {t('cmdk.submitIssue')}
        </CommandItem>
        <CommandItem
          icon={<Star />}
          keywords={t('cmdk.keywords.starGitHub').split(' ')}
          value="star-github"
          onSelect={() => handleExternalLink(SOCIAL_URL.github)}
        >
          {t('cmdk.starOnGitHub')}
        </CommandItem>
        <CommandItem
          icon={<DiscordIcon />}
          keywords={t('cmdk.keywords.discord').split(' ')}
          value="discord"
          onSelect={() => handleExternalLink(SOCIAL_URL.discord)}
        >
          {t('cmdk.communitySupport')}
        </CommandItem>
      </Command.Group>
    </>
  );
});

MainMenu.displayName = 'MainMenu';

export default MainMenu;
