import { useDebounce } from 'ahooks';
import { useTheme as useNextThemesTheme } from 'next-themes';
import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import { useCreateMenuItems } from '@/app/[variants]/(main)/home/_layout/hooks';
import type { SearchResult } from '@/database/repositories/search';
import { useCreateNewModal } from '@/features/LibraryModal';
import { useGroupWizard } from '@/layout/GlobalProvider/GroupWizardProvider';
import { lambdaClient } from '@/libs/trpc/client';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors/builtinAgentSelectors';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { globalHelpers } from '@/store/global/helpers';
import { useHomeStore } from '@/store/home';

import { useCommandMenuContext } from './CommandMenuContext';
import type { ThemeMode } from './types';

/**
 * Shared methods for CommandMenu
 */
export const useCommandMenu = () => {
  const [open, setOpen] = useGlobalStore((s) => [s.status.showCommandMenu, s.updateSystemStatus]);
  const {
    mounted,
    search,
    setSearch,
    pages,
    setPages,
    typeFilter,
    setTypeFilter,
    page,
    menuContext: context,
    pathname,
  } = useCommandMenuContext();

  const navigate = useNavigate();
  const { setTheme } = useNextThemesTheme();
  const createAgent = useAgentStore((s) => s.createAgent);
  const refreshAgentList = useHomeStore((s) => s.refreshAgentList);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const { openGroupWizard } = useGroupWizard();
  const { createGroupWithMembers, createGroupFromTemplate, createPage } = useCreateMenuItems();
  const { open: openCreateLibraryModal } = useCreateNewModal();

  // Extract agentId from pathname when in agent context
  const agentId = useMemo(() => {
    if (context === 'agent') {
      const match = pathname?.match(/^\/agent\/([^/?]+)/);
      return match?.[1] || undefined;
    }
    return undefined;
  }, [context, pathname]);

  // Debounce search input to reduce API calls
  const debouncedSearch = useDebounce(search, { wait: 600 });

  // Search functionality
  const hasSearch = debouncedSearch.trim().length > 0;
  const searchQuery = debouncedSearch.trim();

  const { data: searchResults, isLoading: isSearching } = useSWR<SearchResult[]>(
    hasSearch ? ['search', searchQuery, agentId, typeFilter] : null,
    async () => {
      const locale = globalHelpers.getCurrentLanguage();
      return lambdaClient.search.query.query({
        agentId,
        limitPerType: typeFilter ? 50 : 5, // Show more results when filtering by type
        locale,
        query: searchQuery,
        type: typeFilter,
      });
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );

  // Close on Escape key and prevent body scroll
  useEffect(() => {
    if (open) {
      const originalStyle = window.getComputedStyle(document.body).overflow;
      document.body.style.overflow = 'hidden';

      return () => {
        document.body.style.overflow = originalStyle;
      };
    }
  }, [open]);

  const closeCommandMenu = () => {
    setOpen({ showCommandMenu: false });
  };

  const handleNavigate = (path: string) => {
    navigate(path);
    closeCommandMenu();
  };

  const handleExternalLink = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
    closeCommandMenu();
  };

  const handleThemeChange = (theme: ThemeMode) => {
    setTheme(theme);
    closeCommandMenu();
  };

  const handleAskLobeAI = () => {
    // Navigate to inbox agent with the message query parameter
    if (inboxAgentId && search.trim()) {
      const message = encodeURIComponent(search.trim());
      navigate(`/agent/${inboxAgentId}?message=${message}`);
      closeCommandMenu();
    }
  };

  const handleAIPainting = () => {
    // Navigate to painting page with search as prompt
    if (search.trim()) {
      const prompt = encodeURIComponent(search.trim());
      navigate(`/image?prompt=${prompt}`);
      closeCommandMenu();
    }
  };

  const handleBack = () => {
    setPages((prev) => prev.slice(0, -1));
  };

  const handleCreateSession = async () => {
    const result = await createAgent({});
    await refreshAgentList();

    // Navigate to the newly created agent
    if (result.agentId) {
      navigate(`/agent/${result.agentId}`);
    }

    closeCommandMenu();
  };

  const [openNewTopicOrSaveTopic] = useChatStore((s) => [s.openNewTopicOrSaveTopic]);

  const handleCreateTopic = async () => {
    openNewTopicOrSaveTopic();
    closeCommandMenu();
  };

  const handleCreateLibrary = async () => {
    closeCommandMenu();
    openCreateLibraryModal({
      onSuccess: (id) => {
        navigate(`/resource/library/${id}`);
      },
    });
  };

  const handleCreatePage = async () => {
    await createPage();
    closeCommandMenu();
  };

  const handleCreateAgentTeam = async () => {
    closeCommandMenu();
    openGroupWizard({
      onCreateCustom: async (selectedAgents, hostConfig, enableSupervisor) => {
        await createGroupWithMembers(selectedAgents, undefined, hostConfig, enableSupervisor);
      },
      onCreateFromTemplate: async (
        templateId,
        hostConfig,
        enableSupervisor,
        selectedMemberTitles,
      ) => {
        await createGroupFromTemplate(
          templateId,
          hostConfig,
          enableSupervisor,
          selectedMemberTitles,
        );
      },
    });
  };

  return {
    closeCommandMenu,
    handleAIPainting,
    handleAskLobeAI,
    handleBack,
    handleCreateAgentTeam,
    handleCreateLibrary,
    handleCreatePage,
    handleCreateSession,
    handleCreateTopic,
    handleExternalLink,
    handleNavigate,
    handleThemeChange,
    hasSearch,
    isSearching,
    mounted,
    open,
    page,
    pages,
    pathname,
    search,
    searchQuery,
    searchResults: searchResults || ([] as SearchResult[]),
    setSearch,
    setTypeFilter,
    typeFilter,
  };
};
