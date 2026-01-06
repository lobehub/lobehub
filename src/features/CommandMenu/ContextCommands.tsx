import { Command } from 'cmdk';
import { ChevronRight } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCommandMenuContext } from './CommandMenuContext';
import { CommandItem } from './components';
import { useCommandMenu } from './useCommandMenu';
import { getContextCommands } from './utils/contextCommands';

const ContextCommands = memo(() => {
  const { t } = useTranslation('setting');
  const { t: tAuth } = useTranslation('auth');
  const { t: tCommon } = useTranslation('common');
  const { handleNavigate } = useCommandMenu();
  const { menuContext, pathname } = useCommandMenuContext();

  // Extract subPath from pathname
  const subPath = useMemo(() => {
    const pathParts = pathname?.split('/').filter(Boolean);
    return pathParts && pathParts.length > 1 ? pathParts[1] : undefined;
  }, [pathname]);

  const commands = getContextCommands(menuContext, subPath);

  if (commands.length === 0) return null;

  // Get localized context name
  const contextName = tCommon(`cmdk.context.${menuContext}`, { defaultValue: menuContext });

  return (
    <Command.Group>
      {commands.map((cmd) => {
        const Icon = cmd.icon;
        // Get localized label using the correct namespace
        let label = cmd.label;
        if (cmd.labelKey) {
          if (cmd.labelNamespace === 'auth') {
            label = tAuth(cmd.labelKey, { defaultValue: cmd.label });
          } else {
            label = t(cmd.labelKey, { defaultValue: cmd.label });
          }
        }
        const searchValue = `${contextName} ${label} ${cmd.keywords.join(' ')}`;

        return (
          <CommandItem
            icon={<Icon />}
            key={cmd.path}
            onSelect={() => handleNavigate(cmd.path)}
            value={searchValue}
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
  );
});

ContextCommands.displayName = 'ContextCommands';

export default ContextCommands;
