import { Command } from 'cmdk';
import { ChevronRight } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCommandMenuContext } from './CommandMenuContext';
import { CommandItem } from './components';
import { useCommandMenu } from './useCommandMenu';
import { CONTEXT_COMMANDS, getContextCommands } from './utils/contextCommands';

const ContextCommands = memo(() => {
  const { t } = useTranslation('setting');
  const { t: tAuth } = useTranslation('auth');
  const { t: tSubscription } = useTranslation('subscription');
  const { t: tCommon } = useTranslation('common');
  const { handleNavigate } = useCommandMenu();
  const { menuContext, pathname } = useCommandMenuContext();

  // Extract subPath from pathname
  const subPath = useMemo(() => {
    const pathParts = pathname?.split('/').filter(Boolean);
    return pathParts && pathParts.length > 1 ? pathParts[1] : undefined;
  }, [pathname]);

  const commands = getContextCommands(menuContext, subPath);

  // Get settings commands to show globally (when not in settings context)
  const globalSettingsCommands = useMemo(() => {
    if (menuContext === 'settings') return [];
    return CONTEXT_COMMANDS.settings;
  }, [menuContext]);

  const hasCommands = commands.length > 0 || globalSettingsCommands.length > 0;

  if (!hasCommands) return null;

  // Get localized context name
  const contextName = tCommon(`cmdk.context.${menuContext}`, { defaultValue: menuContext });
  const settingsContextName = tCommon('cmdk.context.settings', { defaultValue: 'settings' });

  return (
    <>
      {/* Current context commands */}
      {commands.length > 0 && (
        <Command.Group>
          {commands.map((cmd) => {
            const Icon = cmd.icon;
            // Get localized label using the correct namespace
            let label = cmd.label;
            if (cmd.labelKey) {
              if (cmd.labelNamespace === 'auth') {
                label = tAuth(cmd.labelKey, { defaultValue: cmd.label });
              } else if (cmd.labelNamespace === 'subscription') {
                label = tSubscription(cmd.labelKey, { defaultValue: cmd.label });
              } else {
                label = t(cmd.labelKey, { defaultValue: cmd.label });
              }
            }
            // Get localized keywords
            const keywords = cmd.keywordsKey
              ? tCommon(cmd.keywordsKey as any, { defaultValue: cmd.keywords.join(' ') })
              : cmd.keywords.join(' ');
            const searchValue = `${contextName} ${label} ${keywords}`;

            return (
              <CommandItem
                icon={<Icon />}
                key={cmd.path}
                value={searchValue}
                onSelect={() => handleNavigate(cmd.path)}
              >
                <span style={{ opacity: 0.5 }}>{contextName}</span>
                <ChevronRight
                  size={14}
                  style={{
                    display: 'inline',
                    marginInline: '6px',
                    opacity: 0.5,
                    verticalAlign: 'middle',
                  }}
                />
                {label}
              </CommandItem>
            );
          })}
        </Command.Group>
      )}

      {/* Global settings commands (searchable from any page) */}
      {globalSettingsCommands.length > 0 && (
        <Command.Group>
          {globalSettingsCommands.map((cmd) => {
            const Icon = cmd.icon;
            // Get localized label using the correct namespace
            let label = cmd.label;
            if (cmd.labelKey) {
              if (cmd.labelNamespace === 'auth') {
                label = tAuth(cmd.labelKey, { defaultValue: cmd.label });
              } else if (cmd.labelNamespace === 'subscription') {
                label = tSubscription(cmd.labelKey, { defaultValue: cmd.label });
              } else {
                label = t(cmd.labelKey, { defaultValue: cmd.label });
              }
            }
            // Get localized keywords
            const keywords = cmd.keywordsKey
              ? tCommon(cmd.keywordsKey as any, { defaultValue: cmd.keywords.join(' ') })
              : cmd.keywords.join(' ');
            const searchValue = `${settingsContextName} ${label} ${keywords}`;

            return (
              <CommandItem
                icon={<Icon />}
                key={cmd.path}
                unpinned={true}
                value={searchValue}
                onSelect={() => handleNavigate(cmd.path)}
              >
                <span style={{ opacity: 0.5 }}>{settingsContextName}</span>
                <ChevronRight
                  size={14}
                  style={{
                    display: 'inline',
                    marginInline: '6px',
                    opacity: 0.5,
                    verticalAlign: 'middle',
                  }}
                />
                {label}
              </CommandItem>
            );
          })}
        </Command.Group>
      )}
    </>
  );
});

ContextCommands.displayName = 'ContextCommands';

export default ContextCommands;
