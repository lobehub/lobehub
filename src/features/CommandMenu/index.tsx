'use client';

import { Avatar } from '@lobehub/ui';
import { Command } from 'cmdk';
import { CornerDownLeft } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import { useGlobalStore } from '@/store/global';

import AskAIMenu from './AskAIMenu';
import AskAgentCommands from './AskAgentCommands';
import { CommandMenuProvider, useCommandMenuContext } from './CommandMenuContext';
import MainMenu from './MainMenu';
import SearchResults from './SearchResults';
import ThemeMenu from './ThemeMenu';
import CommandFooter from './components/CommandFooter';
import CommandInput from './components/CommandInput';
import { styles } from './styles';
import { useCommandMenu } from './useCommandMenu';

/**
 * Inner component that uses the context
 */
const CommandMenuContent = memo(() => {
  const { t } = useTranslation('common');
  const {
    closeCommandMenu,
    handleBack,
    handleSendToSelectedAgent,
    hasSearch,
    isSearching,
    searchQuery,
    searchResults,
    selectedAgent,
  } = useCommandMenu();

  const { setPages, page, pages, search, setTypeFilter, setSelectedAgent, typeFilter } =
    useCommandMenuContext();

  return (
    <div className={styles.overlay} onClick={closeCommandMenu}>
      <div onClick={(e) => e.stopPropagation()}>
        <Command
          className={styles.commandRoot}
          onKeyDown={(e) => {
            // Enter key to send message to selected agent
            if (e.key === 'Enter' && selectedAgent && search.trim()) {
              e.preventDefault();
              handleSendToSelectedAgent();
              return;
            }
            // Tab key to ask AI
            if (e.key === 'Tab' && page !== 'ask-ai' && !selectedAgent) {
              e.preventDefault();
              setPages([...pages, 'ask-ai']);
              return;
            }
            // Escape goes to previous page, clears selected agent, or closes
            if (e.key === 'Escape') {
              e.preventDefault();
              if (selectedAgent) {
                setSelectedAgent(undefined);
              } else if (pages.length > 0) {
                handleBack();
              } else {
                closeCommandMenu();
              }
            }
            // Backspace clears selected agent when search is empty, or goes to previous page
            if (e.key === 'Backspace' && !search) {
              if (selectedAgent) {
                e.preventDefault();
                setSelectedAgent(undefined);
              } else if (pages.length > 0) {
                e.preventDefault();
                setPages((prev) => prev.slice(0, -1));
              }
            }
          }}
          shouldFilter={page !== 'ask-ai' && !selectedAgent && !search.trimStart().startsWith('@')}
        >
          <CommandInput />

          <Command.List>
            <Command.Empty>{t('cmdk.noResults')}</Command.Empty>

            {/* Show send command when agent is selected */}
            {selectedAgent && (
              <Command.Group>
                <Command.Item
                  disabled={!search.trim()}
                  onSelect={handleSendToSelectedAgent}
                  value="send-to-agent"
                >
                  <Avatar
                    avatar={selectedAgent.avatar}
                    emojiScaleWithBackground
                    shape="square"
                    size={20}
                  />
                  <div className={styles.itemContent}>
                    <div className={styles.itemLabel}>
                      {t('cmdk.sendToAgent', { agent: selectedAgent.title } as any)}
                    </div>
                  </div>
                  <CornerDownLeft className={styles.icon} />
                </Command.Item>
              </Command.Group>
            )}

            {/* @ mention agent commands */}
            {!page && !selectedAgent && <AskAgentCommands />}

            {/* Hide MainMenu and SearchResults when in @ mention mode */}
            {!page && !selectedAgent && !search.trimStart().startsWith('@') && <MainMenu />}

            {page === 'theme' && <ThemeMenu />}
            {page === 'ask-ai' && <AskAIMenu />}

            {!page && !selectedAgent && hasSearch && !search.trimStart().startsWith('@') && (
              <SearchResults
                isLoading={isSearching}
                onClose={closeCommandMenu}
                onSetTypeFilter={setTypeFilter}
                results={searchResults}
                searchQuery={searchQuery}
                typeFilter={typeFilter}
              />
            )}
          </Command.List>

          <CommandFooter />
        </Command>
      </div>
    </div>
  );
});

CommandMenuContent.displayName = 'CommandMenuContent';

/**
 * CMDK Menu.
 *
 * Search everything in LobeHub.
 */
const CommandMenu = memo(() => {
  const [open] = useGlobalStore((s) => [s.status.showCommandMenu]);
  const [mounted, setMounted] = useState(false);
  const [appRoot, setAppRoot] = useState<HTMLElement | null>(null);
  const location = useLocation();
  const pathname = location.pathname;

  // Ensure we're mounted on the client
  useEffect(() => {
    setMounted(true);
  }, []);

  // Find App root node (.ant-app)
  useEffect(() => {
    if (!mounted) return;

    const appElement = document.querySelector('.ant-app') as HTMLElement;
    if (appElement) {
      setAppRoot(appElement);
      return;
    }

    // Fallback: use MutationObserver only if .ant-app not found yet
    // Observe only direct children of body for better performance
    const observer = new MutationObserver((_, obs) => {
      const el = document.querySelector('.ant-app') as HTMLElement;
      if (el) {
        setAppRoot(el);
        obs.disconnect(); // Stop observing once found
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: false, // Only watch direct children, not entire DOM tree
    });

    // Fallback timeout: if .ant-app not found after 2s, use body
    const timeoutId = setTimeout(() => {
      observer.disconnect();
      setAppRoot((prev) => prev || document.body);
    }, 2000);

    return () => {
      observer.disconnect();
      clearTimeout(timeoutId);
    };
  }, [mounted]);

  if (!mounted || !open || !appRoot) return null;

  return createPortal(
    <CommandMenuProvider pathname={pathname}>
      <CommandMenuContent />
    </CommandMenuProvider>,
    appRoot,
  );
});

CommandMenu.displayName = 'CommandMenu';

export default CommandMenu;
