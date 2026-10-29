'use client';

import { TOPIC_MESSAGE_SEARCH_LIMIT } from '@lobechat/const';
import type { TopicMessageSearchMatch } from '@lobechat/types';
import {
  ActionIcon,
  cssVar as lobeCssVar,
  Flexbox,
  Icon,
  Input,
  Skeleton,
  Text,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useDebounce } from 'ahooks';
import dayjs from 'dayjs';
import { ChevronDownIcon, ChevronUpIcon, SearchIcon } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';

import { TOPIC_SEARCH_HIGHLIGHT } from './conversationHighlights';
import { splitHighlightSegments } from './highlightSegments';
import { useConversationHighlight } from './useConversationHighlight';
import { useMatchNavigation } from './useMatchNavigation';
import { useTopicSearch } from './useTopicSearch';

const SEARCH_DEBOUNCE_MS = 250;

// `::highlight()` is a document-level pseudo-element, so it cannot be a scoped
// StyleX rule. React hoists and dedupes this sheet by its `href`.
const HIGHLIGHT_SHEET = `
::highlight(${TOPIC_SEARCH_HIGHLIGHT.all}) { background-color: ${lobeCssVar.colorWarningBgHover}; }
::highlight(${TOPIC_SEARCH_HIGHLIGHT.active}) { background-color: ${lobeCssVar.colorWarningBorder}; }
`;

const styles = stylex.create({
  header: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    paddingBlock: 8,
    paddingInline: 12,
  },
  item: {
    borderRadius: 6,
    cursor: 'pointer',
    paddingBlock: 6,
    paddingInline: 8,
    backgroundColor: {
      ':hover': cssVar.colorFillTertiary,
      'default': 'transparent',
    },
  },
  itemActive: {
    backgroundColor: {
      ':hover': cssVar.colorFillSecondary,
      'default': cssVar.colorFillSecondary,
    },
  },
  list: {
    flex: '1',
    minHeight: 0,
    overflowY: 'auto',
    paddingBlock: 6,
    paddingInline: 6,
  },
  mark: {
    backgroundColor: cssVar.colorWarningBgHover,
    borderRadius: 2,
    color: 'inherit',
  },
  meta: {
    color: cssVar.colorTextTertiary,
    fontSize: 12,
  },
  position: {
    color: cssVar.colorTextTertiary,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  snippet: {
    color: cssVar.colorText,
    fontSize: 13,
    lineHeight: 1.5,
    overflowWrap: 'anywhere',
  },
});

interface MatchItemProps {
  active: boolean;
  keyword: string;
  label: string;
  match: TopicMessageSearchMatch;
  onSelect: (id: string) => void;
}

const MatchItem = memo<MatchItemProps>(({ active, keyword, label, match, onSelect }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div
      aria-selected={active}
      ref={ref}
      role={'option'}
      {...stylex.props(styles.item, active && styles.itemActive)}
      onClick={() => onSelect(match.id)}
    >
      <Flexbox horizontal gap={8} justify={'space-between'} {...stylex.props(styles.meta)}>
        <span>{label}</span>
        <span>{dayjs(match.createdAt).format('MM-DD HH:mm')}</span>
      </Flexbox>
      <div {...stylex.props(styles.snippet)}>
        {splitHighlightSegments(match.snippet, keyword).map((segment, index) =>
          segment.match ? (
            <mark key={index} {...stylex.props(styles.mark)}>
              {segment.text}
            </mark>
          ) : (
            segment.text
          ),
        )}
      </div>
    </div>
  );
});

MatchItem.displayName = 'TopicSearchMatchItem';

interface TopicSearchPaneProps {
  /** The pane is on screen: focus the input and paint matches into the conversation. */
  active: boolean;
  topicId: string;
}

/** Find-in-topic: searches the topic's whole history and jumps to a match in the conversation. */
export const TopicSearchPane = memo<TopicSearchPaneProps>(({ active, topicId }) => {
  const { t } = useTranslation('chat');
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const keyword = useDebounce(value, { wait: SEARCH_DEBOUNCE_MS }).trim();
  const { failed, isSearching, matches, retry } = useTopicSearch(topicId, keyword);
  const matchIds = useMemo(() => matches.map((match) => match.id), [matches]);
  const { activeId, activeIndex, select, step } = useMatchNavigation(matchIds);
  const agentName = useAgentStore(agentSelectors.currentAgentDisplayName);
  const focusRequest = useGlobalStore((s) =>
    s.status.workingSidebarTabRequest?.tab === 'search'
      ? s.status.workingSidebarTabRequest.nonce
      : undefined,
  );

  useConversationHighlight({ activeMessageId: activeId, enabled: active, keyword });

  // Mod+F lands here: focus and select, so typing replaces the last keyword.
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => clearTimeout(timer);
  }, [active, focusRequest]);

  const roleLabel = (role: string) =>
    role === 'user'
      ? t('workingPanel.search.role.user')
      : agentName || t('workingPanel.search.role.assistant');

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') step(event.shiftKey ? -1 : 1);
    else if (event.key === 'ArrowDown') step(1);
    else if (event.key === 'ArrowUp') step(-1);
    else if (event.key === 'Escape' && value) setValue('');
    else return;

    event.preventDefault();
    event.stopPropagation();
  };

  const renderBody = () => {
    if (!keyword)
      return (
        <Text fontSize={12} type={'secondary'}>
          {t('workingPanel.search.hint')}
        </Text>
      );
    if (failed)
      return (
        <Text fontSize={12} type={'secondary'}>
          {t('workingPanel.search.error')} <a onClick={retry}>{t('workingPanel.search.retry')}</a>
        </Text>
      );
    if (isSearching && matches.length === 0) return <Skeleton.Text rows={4} />;
    if (matches.length === 0)
      return (
        <Text fontSize={12} type={'secondary'}>
          {t('workingPanel.search.empty', { keyword })}
        </Text>
      );

    return (
      <Flexbox gap={2} role={'listbox'}>
        {matches.map((match) => (
          <MatchItem
            active={match.id === activeId}
            key={match.id}
            keyword={keyword}
            label={roleLabel(match.role)}
            match={match}
            onSelect={select}
          />
        ))}
        {matches.length >= TOPIC_MESSAGE_SEARCH_LIMIT && (
          <Text fontSize={12} style={{ padding: 8 }} type={'secondary'}>
            {t('workingPanel.search.limitReached', { count: TOPIC_MESSAGE_SEARCH_LIMIT })}
          </Text>
        )}
      </Flexbox>
    );
  };

  return (
    <Flexbox flex={1} style={{ minHeight: 0 }}>
      <style href={'lobe-topic-search-highlight'} precedence={'default'}>
        {HIGHLIGHT_SHEET}
      </style>
      <Flexbox gap={6} {...stylex.props(styles.header)}>
        <Input
          placeholder={t('workingPanel.search.placeholder')}
          prefix={<Icon icon={SearchIcon} size={13} />}
          ref={inputRef}
          size={'small'}
          value={value}
          suffix={
            <Flexbox horizontal align={'center'} gap={2}>
              {matches.length > 0 && (
                <span {...stylex.props(styles.position)}>
                  {activeIndex + 1}/{matches.length}
                </span>
              )}
              <ActionIcon
                disabled={matches.length === 0}
                icon={ChevronUpIcon}
                size={'small'}
                title={t('workingPanel.search.prev')}
                onClick={() => step(-1)}
              />
              <ActionIcon
                disabled={matches.length === 0}
                icon={ChevronDownIcon}
                size={'small'}
                title={t('workingPanel.search.next')}
                onClick={() => step(1)}
              />
            </Flexbox>
          }
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        {matches.length > 0 && (
          <Text fontSize={12} type={'secondary'}>
            {t('workingPanel.search.resultCount', { count: matches.length })}
          </Text>
        )}
      </Flexbox>
      <div {...stylex.props(styles.list)}>{renderBody()}</div>
    </Flexbox>
  );
});

TopicSearchPane.displayName = 'TopicSearchPane';
