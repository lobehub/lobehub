import { Command } from 'cmdk';
import dayjs from 'dayjs';
import { Bot, FileText, MessageCircle, MessageSquare, Plug, Puzzle, Sparkles } from 'lucide-react';
import { markdownToTxt } from 'markdown-to-txt';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import type { SearchResult } from '@/database/repositories/search';

import { useCommandMenuContext } from './CommandMenuContext';
import { CommandItem } from './components';
import { styles } from './styles';
import type { ValidSearchType } from './utils/queryParser';

interface SearchResultsProps {
  isLoading: boolean;
  onClose: () => void;
  onSetTypeFilter: (typeFilter: ValidSearchType | undefined) => void;
  results: SearchResult[];
  searchQuery: string;
  typeFilter: ValidSearchType | undefined;
}

/**
 * Search results from unified search index.
 */
const SearchResults = memo<SearchResultsProps>(
  ({ isLoading, onClose, onSetTypeFilter, results, searchQuery, typeFilter }) => {
    const { t } = useTranslation('common');
    const navigate = useNavigate();
    const { menuContext } = useCommandMenuContext();

    const handleNavigate = (result: SearchResult) => {
      switch (result.type) {
        case 'agent': {
          navigate(`/agent/${result.id}?agent=${result.id}`);
          break;
        }
        case 'topic': {
          if (result.agentId) {
            navigate(`/agent/${result.agentId}?topic=${result.id}`);
          } else {
            navigate(`/chat?topic=${result.id}`);
          }
          break;
        }
        case 'message': {
          // Navigate to the topic/agent where the message is
          if (result.topicId && result.agentId) {
            navigate(`/agent/${result.agentId}?topic=${result.topicId}#${result.id}`);
          } else if (result.topicId) {
            navigate(`/chat?topic=${result.topicId}#${result.id}`);
          } else if (result.agentId) {
            navigate(`/agent/${result.agentId}#${result.id}`);
          } else {
            navigate(`/chat#${result.id}`);
          }
          break;
        }
        case 'file': {
          // Navigate to resource library with file parameter
          if (result.knowledgeBaseId) {
            navigate(`/resource/library/${result.knowledgeBaseId}?file=${result.id}`);
          } else {
            // Fallback to library root if no knowledge base
            navigate(`/resource/library?file=${result.id}`);
          }
          break;
        }
        case 'page': {
          navigate(`/page/${result.id.split('_')[1]}`);
          break;
        }
        case 'mcp': {
          navigate(`/community/mcp/${result.identifier}`);
          break;
        }
        case 'plugin': {
          navigate(`/community/plugins/${result.identifier}`);
          break;
        }
        case 'communityAgent': {
          navigate(`/community/assistant/${result.identifier}`);
          break;
        }
      }
      onClose();
    };

    const getIcon = (type: SearchResult['type']) => {
      switch (type) {
        case 'agent': {
          return <Sparkles size={16} />;
        }
        case 'topic': {
          return <MessageSquare size={16} />;
        }
        case 'message': {
          return <MessageCircle size={16} />;
        }
        case 'file': {
          return <FileText size={16} />;
        }
        case 'page': {
          return <FileText size={16} />;
        }
        case 'mcp': {
          return <Puzzle size={16} />;
        }
        case 'plugin': {
          return <Plug size={16} />;
        }
        case 'communityAgent': {
          return <Bot size={16} />;
        }
      }
    };

    const getTypeLabel = (type: SearchResult['type']) => {
      switch (type) {
        case 'agent': {
          return t('cmdk.search.agent');
        }
        case 'topic': {
          return t('cmdk.search.topic');
        }
        case 'message': {
          return t('cmdk.search.message');
        }
        case 'file': {
          return t('cmdk.search.file');
        }
        case 'page': {
          return t('cmdk.search.page');
        }
        case 'mcp': {
          return t('cmdk.search.mcp');
        }
        case 'plugin': {
          return t('cmdk.search.plugin');
        }
        case 'communityAgent': {
          return t('cmdk.search.assistant');
        }
      }
    };

    // Get trailing label for search results (shows "Market" for marketplace items)
    const getTrailingLabel = (type: SearchResult['type']) => {
      // Marketplace items: MCP, plugins, assistants
      if (type === 'mcp' || type === 'plugin' || type === 'communityAgent') {
        return t('cmdk.search.market');
      }
      return getTypeLabel(type);
    };

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const getItemValue = (result: SearchResult) => {
      const meta = [result.title, result.description].filter(Boolean).join(' ');
      // Prefix with "search-result" to ensure these items rank after built-in commands
      // Include ID to ensure uniqueness when multiple items have the same title
      return `search-result ${result.type} ${result.id} ${meta}`.trim();
    };

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const getDescription = (result: SearchResult) => {
      if (!result.description) return null;
      // Sanitize markdown content for message search results
      if (result.type === 'message') {
        return markdownToTxt(result.description);
      }
      return result.description;
    };

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const getSubtitle = (result: SearchResult) => {
      const description = getDescription(result);

      // For topic and message results, append creation date
      if (result.type === 'topic' || result.type === 'message') {
        const formattedDate = dayjs(result.createdAt).format('MMM D, YYYY');
        if (description) {
          return `${description} · ${formattedDate}`;
        }
        return formattedDate;
      }

      return description;
    };

    const handleSearchMore = (type: ValidSearchType) => {
      onSetTypeFilter(type);
    };

    // Helper to render "Search More" button
    const renderSearchMore = (type: ValidSearchType, count: number) => {
      // Don't show if already filtering by this type
      if (typeFilter) return null;

      // Show if there are results (might have more)
      if (count === 0) return null;

      return (
        <CommandItem
          forceMount
          icon={getIcon(type)}
          onSelect={() => handleSearchMore(type)}
          title={t('cmdk.search.searchMore', { type: getTypeLabel(type) })}
          value={`action-show-more-results-for-type-${type}`}
          variant="detailed"
        />
      );
    };

    const hasResults = results.length > 0;

    // Group results by type
    const messageResults = results.filter((r) => r.type === 'message');
    const agentResults = results.filter((r) => r.type === 'agent');
    const topicResults = results.filter((r) => r.type === 'topic');
    const fileResults = results.filter((r) => r.type === 'file');
    const pageResults = results.filter((r) => r.type === 'page');
    const mcpResults = results.filter((r) => r.type === 'mcp');
    const pluginResults = results.filter((r) => r.type === 'plugin');
    const assistantResults = results.filter((r) => r.type === 'communityAgent');

    // Detect context types
    const isResourceContext = menuContext === 'resource';
    const isPageContext = menuContext === 'page';

    // Don't render anything if no results and not loading
    if (!hasResults && !isLoading) {
      return null;
    }

    return (
      <>
        {/* Show pages first in page context */}
        {hasResults && isPageContext && pageResults.length > 0 && (
          <Command.Group heading={t('cmdk.search.pages')} key="pages-page-context">
            {pageResults.map((result) => (
              <CommandItem
                description={result.description}
                icon={getIcon(result.type)}
                key={`page-page-context-${result.id}`}
                onSelect={() => handleNavigate(result)}
                title={result.title}
                trailingLabel={getTrailingLabel(result.type)}
                value={getItemValue(result)}
                variant="detailed"
              />
            ))}
            {renderSearchMore('page', pageResults.length)}
          </Command.Group>
        )}

        {/* Show other results in page context */}
        {hasResults && isPageContext && fileResults.length > 0 && (
          <Command.Group heading={t('cmdk.search.files')}>
            {fileResults.map((result) => (
              <CommandItem
                description={result.type === 'file' ? result.fileType : undefined}
                icon={getIcon(result.type)}
                key={`file-page-context-${result.id}`}
                onSelect={() => handleNavigate(result)}
                title={result.title}
                trailingLabel={getTrailingLabel(result.type)}
                value={getItemValue(result)}
                variant="detailed"
              />
            ))}
            {renderSearchMore('file', fileResults.length)}
          </Command.Group>
        )}

        {hasResults && isPageContext && agentResults.length > 0 && (
          <Command.Group heading={t('cmdk.search.agents')}>
            {agentResults.map((result) => (
              <CommandItem
                description={getDescription(result)}
                icon={getIcon(result.type)}
                key={`agent-page-context-${result.id}`}
                onSelect={() => handleNavigate(result)}
                title={result.title}
                trailingLabel={getTrailingLabel(result.type)}
                value={getItemValue(result)}
                variant="detailed"
              />
            ))}
            {renderSearchMore('agent', agentResults.length)}
          </Command.Group>
        )}

        {hasResults && isPageContext && topicResults.length > 0 && (
          <Command.Group heading={t('cmdk.search.topics')}>
            {topicResults.map((result) => (
              <CommandItem
                description={getSubtitle(result)}
                icon={getIcon(result.type)}
                key={`topic-page-context-${result.id}`}
                onSelect={() => handleNavigate(result)}
                title={result.title}
                trailingLabel={getTrailingLabel(result.type)}
                value={getItemValue(result)}
                variant="detailed"
              />
            ))}
            {renderSearchMore('topic', topicResults.length)}
          </Command.Group>
        )}

        {hasResults && isPageContext && messageResults.length > 0 && (
          <Command.Group heading={t('cmdk.search.messages')}>
            {messageResults.map((result) => (
              <CommandItem
                description={getSubtitle(result)}
                icon={getIcon(result.type)}
                key={`message-page-context-${result.id}`}
                onSelect={() => handleNavigate(result)}
                title={result.title}
                trailingLabel={getTrailingLabel(result.type)}
                value={getItemValue(result)}
                variant="detailed"
              />
            ))}
            {renderSearchMore('message', messageResults.length)}
          </Command.Group>
        )}

        {/* Show pages first in resource context */}
        {hasResults && isResourceContext && pageResults.length > 0 && (
          <Command.Group heading={t('cmdk.search.pages')} key="pages-resource">
            {pageResults.map((result) => (
              <CommandItem
                description={result.description}
                icon={getIcon(result.type)}
                key={`page-resource-${result.id}`}
                onSelect={() => handleNavigate(result)}
                title={result.title}
                trailingLabel={getTrailingLabel(result.type)}
                value={getItemValue(result)}
                variant="detailed"
              />
            ))}
            {renderSearchMore('page', pageResults.length)}
          </Command.Group>
        )}

        {/* Show files in resource context */}
        {hasResults && isResourceContext && fileResults.length > 0 && (
          <Command.Group heading={t('cmdk.search.files')}>
            {fileResults.map((result) => (
              <CommandItem
                description={result.type === 'file' ? result.fileType : undefined}
                icon={getIcon(result.type)}
                key={`file-${result.id}`}
                onSelect={() => handleNavigate(result)}
                title={result.title}
                trailingLabel={getTrailingLabel(result.type)}
                value={getItemValue(result)}
                variant="detailed"
              />
            ))}
            {renderSearchMore('file', fileResults.length)}
          </Command.Group>
        )}

        {hasResults && !isPageContext && !isResourceContext && messageResults.length > 0 && (
          <Command.Group heading={t('cmdk.search.messages')}>
            {messageResults.map((result) => (
              <CommandItem
                description={getSubtitle(result)}
                icon={getIcon(result.type)}
                key={`message-${result.id}`}
                onSelect={() => handleNavigate(result)}
                title={result.title}
                trailingLabel={getTrailingLabel(result.type)}
                value={getItemValue(result)}
                variant="detailed"
              />
            ))}
            {renderSearchMore('message', messageResults.length)}
          </Command.Group>
        )}

        {hasResults && !isPageContext && agentResults.length > 0 && (
          <Command.Group heading={t('cmdk.search.agents')}>
            {agentResults.map((result) => (
              <CommandItem
                description={getDescription(result)}
                icon={getIcon(result.type)}
                key={`agent-${result.id}`}
                onSelect={() => handleNavigate(result)}
                title={result.title}
                trailingLabel={getTrailingLabel(result.type)}
                value={getItemValue(result)}
                variant="detailed"
              />
            ))}
            {renderSearchMore('agent', agentResults.length)}
          </Command.Group>
        )}

        {hasResults && !isPageContext && topicResults.length > 0 && (
          <Command.Group heading={t('cmdk.search.topics')}>
            {topicResults.map((result) => (
              <CommandItem
                description={getSubtitle(result)}
                icon={getIcon(result.type)}
                key={`topic-${result.id}`}
                onSelect={() => handleNavigate(result)}
                title={result.title}
                trailingLabel={getTrailingLabel(result.type)}
                value={getItemValue(result)}
                variant="detailed"
              />
            ))}
            {renderSearchMore('topic', topicResults.length)}
          </Command.Group>
        )}

        {/* Show document pages in normal context (not in resource or page context) */}
        {hasResults && !isResourceContext && !isPageContext && pageResults.length > 0 && (
          <Command.Group heading={t('cmdk.search.pages')} key="pages-normal">
            {pageResults.map((result) => (
              <CommandItem
                description={result.description}
                icon={getIcon(result.type)}
                key={`page-normal-${result.id}`}
                onSelect={() => handleNavigate(result)}
                title={result.title}
                trailingLabel={getTrailingLabel(result.type)}
                value={getItemValue(result)}
                variant="detailed"
              />
            ))}
            {renderSearchMore('page', pageResults.length)}
          </Command.Group>
        )}

        {/* Show files in original position when NOT in resource or page context */}
        {hasResults && !isResourceContext && !isPageContext && fileResults.length > 0 && (
          <Command.Group heading={t('cmdk.search.files')}>
            {fileResults.map((result) => (
              <CommandItem
                description={result.type === 'file' ? result.fileType : undefined}
                icon={getIcon(result.type)}
                key={`file-${result.id}`}
                onSelect={() => handleNavigate(result)}
                title={result.title}
                trailingLabel={getTrailingLabel(result.type)}
                value={getItemValue(result)}
                variant="detailed"
              />
            ))}
            {renderSearchMore('file', fileResults.length)}
          </Command.Group>
        )}

        {hasResults && mcpResults.length > 0 && (
          <Command.Group heading={t('cmdk.search.mcps')}>
            {mcpResults.map((result) => (
              <CommandItem
                description={getDescription(result)}
                icon={getIcon(result.type)}
                key={`mcp-${result.id}`}
                onSelect={() => handleNavigate(result)}
                title={result.title}
                trailingLabel={getTrailingLabel(result.type)}
                value={getItemValue(result)}
                variant="detailed"
              />
            ))}
            {renderSearchMore('mcp', mcpResults.length)}
          </Command.Group>
        )}

        {hasResults && pluginResults.length > 0 && (
          <Command.Group heading={t('cmdk.search.plugins')}>
            {pluginResults.map((result) => (
              <CommandItem
                description={getDescription(result)}
                icon={getIcon(result.type)}
                key={`plugin-${result.id}`}
                onSelect={() => handleNavigate(result)}
                title={result.title}
                trailingLabel={getTrailingLabel(result.type)}
                value={getItemValue(result)}
                variant="detailed"
              />
            ))}
            {renderSearchMore('plugin', pluginResults.length)}
          </Command.Group>
        )}

        {hasResults && assistantResults.length > 0 && (
          <Command.Group heading={t('cmdk.search.assistants')}>
            {assistantResults.map((result) => (
              <CommandItem
                description={getDescription(result)}
                icon={getIcon(result.type)}
                key={`assistant-${result.id}`}
                onSelect={() => handleNavigate(result)}
                title={result.title}
                trailingLabel={getTrailingLabel(result.type)}
                value={getItemValue(result)}
                variant="detailed"
              />
            ))}
            {renderSearchMore('communityAgent', assistantResults.length)}
          </Command.Group>
        )}

        {/* Show loading skeleton below existing results */}
        {isLoading && (
          <Command.Group>
            {[1, 2, 3].map((i) => (
              <Command.Item
                disabled
                key={`skeleton-${i}`}
                keywords={[searchQuery]}
                value={`${searchQuery}-loading-skeleton-${i}`}
              >
                <div className={styles.skeleton} style={{ height: 20, width: 20 }} />
                <div style={{ display: 'flex', flex: 1, flexDirection: 'column', gap: 4 }}>
                  <div className={styles.skeleton} style={{ width: `${60 + i * 10}%` }} />
                  <div
                    className={styles.skeleton}
                    style={{ height: 12, width: `${40 + i * 5}%` }}
                  />
                </div>
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </>
    );
  },
);

SearchResults.displayName = 'SearchResults';

export default SearchResults;
