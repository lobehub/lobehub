'use client';

import { Command } from 'cmdk';
import { memo, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import { useGlobalStore } from '@/store/global';

import AskAIMenu from './AskAIMenu';
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
  const { closeCommandMenu, handleBack, hasSearch, isSearching, searchQuery, searchResults } =
    useCommandMenu();

  const { setPages, page, pages, search, setTypeFilter, typeFilter } = useCommandMenuContext();

  return (
    <div className={styles.overlay} onClick={closeCommandMenu}>
      <div onClick={(e) => e.stopPropagation()}>
        <Command
          className={styles.commandRoot}
          onKeyDown={(e) => {
            // Tab key to ask AI
            if (e.key === 'Tab' && page !== 'ask-ai') {
              e.preventDefault();
              setPages([...pages, 'ask-ai']);
              return;
            }
            // Escape goes to previous page or closes
            if (e.key === 'Escape') {
              e.preventDefault();
              if (pages.length > 0) {
                handleBack();
              } else {
                closeCommandMenu();
              }
            }
            // Backspace goes to previous page when search is empty
            if (e.key === 'Backspace' && !search && pages.length > 0) {
              e.preventDefault();
              setPages((prev) => prev.slice(0, -1));
            }
          }}
          shouldFilter={page !== 'ask-ai'}
        >
          <CommandInput />

          <Command.List>
            <Command.Empty>{t('cmdk.noResults')}</Command.Empty>

            {!page && <MainMenu />}

            {page === 'theme' && <ThemeMenu />}
            {page === 'ask-ai' && <AskAIMenu />}

            {!page && hasSearch && (
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

    const findAppRoot = () => {
      const appElement = document.querySelector('.ant-app') as HTMLElement;
      if (appElement) {
        setAppRoot(appElement);
      } else {
        // Fallback to body if App root not found
        setAppRoot(document.body);
      }
    };

    findAppRoot();

    // Use MutationObserver to handle dynamic rendering
    const observer = new MutationObserver(findAppRoot);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
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
