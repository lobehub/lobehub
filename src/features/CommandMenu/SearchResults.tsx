import { Command } from 'cmdk';
import dayjs from 'dayjs';
import {
  Bot,
  Brain,
  ChevronRight,
  FileText,
  Folder,
  Library,
  MessageCircle,
  MessageSquare,
  Plug,
  Puzzle,
  Sparkles,
  Users,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { type SearchResult } from '@/database/repositories/search';
import { useCommandMenuContext } from '@/features/CommandMenu/CommandMenuContext';
import { useImageStore } from '@/store/image';
import { generationTopicSelectors as imageGenerationTopicSelectors } from '@/store/image/slices/generationTopic/selectors';
import { useVideoStore } from '@/store/video';
import { generationTopicSelectors as videoGenerationTopicSelectors } from '@/store/video/slices/generationTopic/selectors';
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

interface LocalGenerationTopicResult {
  createdAt: Date;
  id: string;
  title: string;
  updatedAt: Date;
}

/**
 * Search results from unified search index.
 */
const SearchResults = memo<SearchResultsProps>(
  ({ isLoading, onClose, onSetTypeFilter, results, searchQuery, typeFilter }) => {
    const { t } = useTranslation('common');
    const { t: tImage } = useTranslation('image');
    const { t: tVideo } = useTranslation('video');
    const navigate = useNavigate();
    const { menuContext } = useCommandMenuContext();
    const imageTopics = useImageStore(imageGenerationTopicSelectors.generationTopics);
    const activeImageTopicId = useImageStore((s) => s.activeGenerationTopicId);
    const videoTopics = useVideoStore(videoGenerationTopicSelectors.generationTopics);
    const activeVideoTopicId = useVideoStore((s) => s.activeGenerationTopicId);

    const handleNavigate = (result: SearchResult) => {
      switch (result.type) {
        case 'agent': {
          navigate(`/agent/${result.id}?agent=${result.id}`);
          break;
        }
        case 'chatGroup': {
          navigate(`/group/${result.id}`);
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
          console.info('[SearchResults] File navigation:', {
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
        case 'knowledgeBase': {
          navigate(`/resource/library/${result.id}`);
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
        case 'chatGroup': {
          return <Users size={16} />;
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
        case 'knowledgeBase': {
          return <Library size={16} />;
        }
      }
    };

    const getTypeLabel = (type: SearchResult['type']) => {
      switch (type) {
        case 'agent': {
          return t('cmdk.search.agent');
        }
        case 'chatGroup': {
          return t('cmdk.search.chatGroup');
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
        case 'knowledgeBase': {
          return t('cmdk.search.knowledgeBase');
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

    const localImageTopicResults: LocalGenerationTopicResult[] =
      menuContext === 'painting'
        ? (imageTopics || [])
            .filter((topic) => {
              const title = topic.title || tImage('topic.untitled');
              return title.toLowerCase().includes(searchQuery.toLowerCase());
            })
            .sort((a, b) => {
              if (a.id === activeImageTopicId) return -1;
              if (b.id === activeImageTopicId) return 1;
              return b.updatedAt.getTime() - a.updatedAt.getTime();
            })
            .slice(0, 8)
            .map((topic) => ({
              createdAt: topic.createdAt,
              id: topic.id,
              title: topic.title || tImage('topic.untitled'),
              updatedAt: topic.updatedAt,
            }))
        : [];

    const localVideoTopicResults: LocalGenerationTopicResult[] =
      menuContext === 'video'
        ? (videoTopics || [])
            .filter((topic) => {
              const title = topic.title || tVideo('topic.untitled');
              return title.toLowerCase().includes(searchQuery.toLowerCase());
            })
            .sort((a, b) => {
              if (a.id === activeVideoTopicId) return -1;
              if (b.id === activeVideoTopicId) return 1;
              return b.updatedAt.getTime() - a.updatedAt.getTime();
            })
            .slice(0, 8)
            .map((topic) => ({
              createdAt: topic.createdAt,
              id: topic.id,
              title: topic.title || tVideo('topic.untitled'),
              updatedAt: topic.updatedAt,
            }))
        : [];

    const hasResults = results.length > 0;
    const hasLocalTopicResults =
      localImageTopicResults.length > 0 || localVideoTopicResults.length > 0;

    // Group results by type
    const messageResults = results.filter((r) => r.type === 'message');
    const chatGroupResults = results.filter((r) => r.type === 'chatGroup');
    const agentResults = results.filter((r) => r.type === 'agent');
    const topicResults = results.filter((r) => r.type === 'topic');
    const fileResults = results.filter((r) => r.type === 'file');
    const folderResults = results.filter((r) => r.type === 'folder');
    const pageResults = results.filter((r) => r.type === 'page');
    const memoryResults = results.filter((r) => r.type === 'memory');
    const mcpResults = results.filter((r) => r.type === 'mcp');
    const pluginResults = results.filter((r) => r.type === 'plugin');
    const knowledgeBaseResults = results.filter((r) => r.type === 'knowledgeBase');
    const assistantResults = results.filter((r) => r.type === 'communityAgent');

    // Don't render anything if no results and not loading
    if (!hasResults && !hasLocalTopicResults && !isLoading) {
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
          forceMount
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
        {localImageTopicResults.length > 0 && (
          <Command.Group forceMount>
            {localImageTopicResults.map((result) => {
              const formattedDate = dayjs(result.updatedAt).format('MMM D, YYYY');
              return (
                <CommandItem
                  forceMount
                  description={formattedDate}
                  icon={<MessageSquare size={16} />}
                  key={`image-topic-${result.id}`}
                  value={`local-image-topic ${result.id} ${result.title}`}
                  variant="detailed"
                  title={
                    <>
                      <span style={{ opacity: 0.5 }}>{t('tab.image')}</span>
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
                  }
                  onSelect={() => {
                    navigate(`/image?topic=${result.id}`);
                    onClose();
                  }}
                />
              );
            })}
          </Command.Group>
        )}

        {localVideoTopicResults.length > 0 && (
          <Command.Group forceMount>
            {localVideoTopicResults.map((result) => {
              const formattedDate = dayjs(result.updatedAt).format('MMM D, YYYY');
              return (
                <CommandItem
                  forceMount
                  description={formattedDate}
                  icon={<MessageSquare size={16} />}
                  key={`video-topic-${result.id}`}
                  value={`local-video-topic ${result.id} ${result.title}`}
                  variant="detailed"
                  title={
                    <>
                      <span style={{ opacity: 0.5 }}>{t('tab.video')}</span>
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
                  }
                  onSelect={() => {
                    navigate(`/video?topic=${result.id}`);
                    onClose();
                  }}
                />
              );
            })}
          </Command.Group>
        )}

        {/* Render search results grouped by type without headers */}
        {messageResults.length > 0 && (
          <Command.Group forceMount>
            {messageResults.map((result) => renderResultItem(result))}
            {renderSearchMore('message', messageResults.length)}
          </Command.Group>
        )}

        {agentResults.length > 0 && (
          <Command.Group forceMount>
            {agentResults.map((result) => renderResultItem(result))}
            {renderSearchMore('agent', agentResults.length)}
          </Command.Group>
        )}

        {chatGroupResults.length > 0 && (
          <Command.Group forceMount>
            {chatGroupResults.map((result) => renderResultItem(result))}
            {renderSearchMore('chatGroup', chatGroupResults.length)}
          </Command.Group>
        )}

        {topicResults.length > 0 && (
          <Command.Group forceMount>
            {topicResults.map((result) => renderResultItem(result))}
            {renderSearchMore('topic', topicResults.length)}
          </Command.Group>
        )}

        {pageResults.length > 0 && (
          <Command.Group forceMount>
            {pageResults.map((result) => renderResultItem(result))}
            {renderSearchMore('page', pageResults.length)}
          </Command.Group>
        )}

        {memoryResults.length > 0 && (
          <Command.Group forceMount>
            {memoryResults.map((result) => renderResultItem(result))}
            {renderSearchMore('memory', memoryResults.length)}
          </Command.Group>
        )}

        {fileResults.length > 0 && (
          <Command.Group forceMount>
            {fileResults.map((result) => renderResultItem(result))}
            {renderSearchMore('file', fileResults.length)}
          </Command.Group>
        )}

        {folderResults.length > 0 && (
          <Command.Group forceMount>
            {folderResults.map((result) => renderResultItem(result))}
            {renderSearchMore('folder', folderResults.length)}
          </Command.Group>
        )}

        {knowledgeBaseResults.length > 0 && (
          <Command.Group forceMount>
            {knowledgeBaseResults.map((result) => renderResultItem(result))}
            {renderSearchMore('knowledgeBase', knowledgeBaseResults.length)}
          </Command.Group>
        )}

        {mcpResults.length > 0 && (
          <Command.Group forceMount>
            {mcpResults.map((result) => renderResultItem(result))}
            {renderSearchMore('mcp', mcpResults.length)}
          </Command.Group>
        )}

        {pluginResults.length > 0 && (
          <Command.Group forceMount>
            {pluginResults.map((result) => renderResultItem(result))}
            {renderSearchMore('plugin', pluginResults.length)}
          </Command.Group>
        )}

        {assistantResults.length > 0 && (
          <Command.Group forceMount>
            {assistantResults.map((result) => renderResultItem(result))}
            {renderSearchMore('communityAgent', assistantResults.length)}
          </Command.Group>
        )}

        {/* Show loading skeleton below existing results */}
        {isLoading && (
          <Command.Group forceMount>
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
