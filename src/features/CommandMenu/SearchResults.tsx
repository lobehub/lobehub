import { Command } from 'cmdk';
import dayjs from 'dayjs';
import {
  Bot,
  Brain,
  ChevronRight,
  FileText,
  Folder,
  MessageCircle,
  MessageSquare,
  Plug,
  Puzzle,
  Sparkles,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { type SearchResult } from '@/database/repositories/search';
import { markdownToTxt } from '@/utils/markdownToTxt';

import { CommandItem } from './components';
import { styles } from './styles';
import { type ValidSearchType } from './utils/queryParser';

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
          const fileUrl = result.knowledgeBaseId
            ? `/resource/library/${result.knowledgeBaseId}?file=${result.id}`
            : `/resource?file=${result.id}`;
          console.log('[SearchResults] File navigation:', {
            fileDetails: result,
            url: fileUrl,
          });
          navigate(fileUrl);
          break;
        }
        case 'folder': {
          // Navigate to folder by slug
          if (result.knowledgeBaseId && result.slug) {
            navigate(`/resource/library/${result.knowledgeBaseId}/${result.slug}`);
          } else if (result.slug) {
            navigate(`/resource/library/${result.slug}`);
          } else {
            // Fallback to library root if no slug
            navigate(`/resource/library`);
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
          navigate(`/community/mcp/${result.identifier}`);
          break;
        }
        case 'communityAgent': {
          navigate(`/community/agent/${result.identifier}`);
          break;
        }
        case 'memory': {
          navigate(`/memory/preferences?preferenceId=${result.id}`);
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
        case 'folder': {
          return <Folder size={16} />;
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
        case 'memory': {
          return <Brain size={16} />;
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
        case 'folder': {
          return t('cmdk.search.folder');
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
        case 'memory': {
          return t('cmdk.search.memory');
        }
      }
    };

    const getItemValue = (result: SearchResult) => {
      const meta = [result.title, result.description].filter(Boolean).join(' ');
      // Prefix with "search-result" to ensure these items rank after built-in commands
      // Include ID to ensure uniqueness when multiple items have the same title
      return `search-result ${result.type} ${result.id} ${meta}`.trim();
    };

    const getDescription = (result: SearchResult) => {
      if (!result.description) return null;
      // Sanitize markdown content for message search results
      if (result.type === 'message') {
        return markdownToTxt(result.description);
      }
      return result.description;
    };

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

    const hasResults = results.length > 0;

    // Group results by type
    const messageResults = results.filter((r) => r.type === 'message');
    const agentResults = results.filter((r) => r.type === 'agent');
    const topicResults = results.filter((r) => r.type === 'topic');
    const fileResults = results.filter((r) => r.type === 'file');
    const folderResults = results.filter((r) => r.type === 'folder');
    const pageResults = results.filter((r) => r.type === 'page');
    const memoryResults = results.filter((r) => r.type === 'memory');
    const mcpResults = results.filter((r) => r.type === 'mcp');
    const pluginResults = results.filter((r) => r.type === 'plugin');
    const assistantResults = results.filter((r) => r.type === 'communityAgent');

    // Don't render anything if no results and not loading
    if (!hasResults && !isLoading) {
      return null;
    }

    // Render a single result item with type prefix (like "Message > content")
    const renderResultItem = (result: SearchResult) => {
      const typeLabel = getTypeLabel(result.type);
      const subtitle = getSubtitle(result);

      // Hide type prefix when filtering by specific type
      const showTypePrefix = !typeFilter;

      // Create title with or without type prefix
      const titleWithPrefix = showTypePrefix ? (
        <>
          <span style={{ opacity: 0.5 }}>{typeLabel}</span>
          <ChevronRight
            size={14}
            style={{
              display: 'inline',
              marginInline: '6px',
              opacity: 0.5,
              verticalAlign: 'middle',
            }}
          />
          {result.title}
        </>
      ) : (
        result.title
      );

      return (
        <CommandItem
          description={subtitle}
          icon={getIcon(result.type)}
          key={result.id}
          title={titleWithPrefix}
          value={getItemValue(result)}
          variant="detailed"
          onSelect={() => handleNavigate(result)}
        />
      );
    };

    // Helper to render "Search More" button
    const renderSearchMore = (type: ValidSearchType, count: number) => {
      // Don't show if already filtering by this type
      if (typeFilter) return null;

      // Show if there are results (might have more)
      if (count === 0) return null;

      const typeLabel = getTypeLabel(type);
      const titleText = `${t('cmdk.search.searchMore', { type: typeLabel })} with "${searchQuery}"`;

      return (
        <Command.Item
          forceMount
          key={`search-more-${type}`}
          keywords={[`zzz-action-${type}`]}
          value={`zzz-action-${type}-search-more`}
          onSelect={() => handleSearchMore(type)}
        >
          <div className={styles.itemContent}>
            <div className={styles.itemIcon}>{getIcon(type)}</div>
            <div className={styles.itemDetails}>
              <div className={styles.itemTitle}>{titleText}</div>
            </div>
          </div>
        </Command.Item>
      );
    };

    return (
      <>
        {/* Render search results grouped by type without headers */}
        {messageResults.length > 0 && (
          <Command.Group>
            {messageResults.map((result) => renderResultItem(result))}
            {renderSearchMore('message', messageResults.length)}
          </Command.Group>
        )}

        {agentResults.length > 0 && (
          <Command.Group>
            {agentResults.map((result) => renderResultItem(result))}
            {renderSearchMore('agent', agentResults.length)}
          </Command.Group>
        )}

        {topicResults.length > 0 && (
          <Command.Group>
            {topicResults.map((result) => renderResultItem(result))}
            {renderSearchMore('topic', topicResults.length)}
          </Command.Group>
        )}

        {pageResults.length > 0 && (
          <Command.Group>
            {pageResults.map((result) => renderResultItem(result))}
            {renderSearchMore('page', pageResults.length)}
          </Command.Group>
        )}

        {memoryResults.length > 0 && (
          <Command.Group>
            {memoryResults.map((result) => renderResultItem(result))}
            {renderSearchMore('memory', memoryResults.length)}
          </Command.Group>
        )}

        {fileResults.length > 0 && (
          <Command.Group>
            {fileResults.map((result) => renderResultItem(result))}
            {renderSearchMore('file', fileResults.length)}
          </Command.Group>
        )}

        {folderResults.length > 0 && (
          <Command.Group>
            {folderResults.map((result) => renderResultItem(result))}
            {renderSearchMore('folder', folderResults.length)}
          </Command.Group>
        )}

        {mcpResults.length > 0 && (
          <Command.Group>
            {mcpResults.map((result) => renderResultItem(result))}
            {renderSearchMore('mcp', mcpResults.length)}
          </Command.Group>
        )}

        {pluginResults.length > 0 && (
          <Command.Group>
            {pluginResults.map((result) => renderResultItem(result))}
            {renderSearchMore('plugin', pluginResults.length)}
          </Command.Group>
        )}

        {assistantResults.length > 0 && (
          <Command.Group>
            {assistantResults.map((result) => renderResultItem(result))}
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
