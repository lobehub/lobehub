import { SOCIAL_URL } from '@lobechat/business-const';
import { Command } from 'cmdk';
import {
  Bot,
  FeatherIcon,
  FilePen,
  LibraryBig,
  MessageSquarePlusIcon,
  Monitor,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { getNavigableRoutes, getRouteById } from '@/config/routes';

import { useCommandMenuContext } from './CommandMenuContext';
import { CommandItem } from './components';
import ContextCommands from './ContextCommands';
import { useCommandMenu } from './useCommandMenu';

const MainMenu = memo(() => {
  const { pathname, menuContext, setPages, pages } = useCommandMenuContext();
  const { t } = useTranslation('common');

  const {
    handleCreateSession,
    handleCreateTopic,
    handleCreateLibrary,
    handleCreatePage,
    handleNavigate,
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
        {SOCIAL_URL.telegram && (
          <CommandItem
            icon={<FeatherIcon />}
            keywords={t('cmdk.keywords.contactUs').split(' ')}
            value="contact-via-telegram"
            onSelect={() => window.open(SOCIAL_URL.telegram, '_blank')}
          >
            {t('cmdk.contactUs')}
          </CommandItem>
        )}
      </Command.Group>
    </>
  );
});

MainMenu.displayName = 'MainMenu';

export default MainMenu;
