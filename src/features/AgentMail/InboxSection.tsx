'use client';

import { ActionIcon, Button, Checkbox, Flexbox, Icon, Input, Skeleton, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useDebounceFn } from 'ahooks';
import {
  ArchiveRestore,
  CheckCheck,
  Mail,
  MailOpen,
  RefreshCw,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatShortenNumber } from '@/utils/format';
import { isMobileSurface } from '@/utils/mobileSurface';

import InlineError from './InlineError';
import { mailListStyles as styles } from './mailListStyles';
import MailRow from './MailRow';
import { pendingMailDeltas, useMailWritesStore } from './mailWrites';
import { identityStyles } from './styles';
import { useMailActions } from './useMailActions';
import {
  MAIL_VIEWS,
  type MailListItem,
  type MailView,
  useMailCounts,
  useMailList,
} from './useMailList';

const FOLDER_KEYS = {
  drafts: 'identity.mailbox.folder.drafts',
  inbox: 'identity.mailbox.folder.inbox',
  sent: 'identity.mailbox.folder.sent',
  starred: 'identity.mailbox.folder.starred',
  trash: 'identity.mailbox.folder.trash',
} as const satisfies Record<MailView, string>;

const EMPTY_KEYS = {
  drafts: 'identity.mailbox.empty.drafts',
  inbox: 'identity.mailbox.empty.inbox',
  sent: 'identity.mailbox.empty.sent',
  starred: 'identity.mailbox.empty.starred',
  trash: 'identity.mailbox.empty.trash',
} as const satisfies Record<MailView, string>;

interface InboxSectionProps {
  /**
   * The mailbox on screen; the list, the counts and every action stay within
   * it. `undefined` once no address is left: the mail released addresses
   * received is then listed across all of them.
   */
  accountId?: string;
  /** Every address, so the shared counts request matches the switcher's. */
  accountIds: string[];
  agentId: string;
  disabled?: boolean;
  onOpen: (item: MailListItem) => void;
  onQueryChange: (query: string) => void;
  /** Rows that left this view, so an open one can close. */
  onRemoved: (ids: string[]) => void;
  onViewChange: (view: MailView) => void;
  query: string;
  /** The row showing beside the list; it stays highlighted. */
  selectedId?: string;
  view: MailView;
}

/** Follows the URL, but typing only reaches it once the person pauses. */
const SearchBox = ({
  loading,
  onChange,
  query,
}: {
  loading: boolean;
  onChange: (query: string) => void;
  query: string;
}) => {
  const { t } = useTranslation('setting');
  const [value, setValue] = useState(query);
  const [synced, setSynced] = useState(query);
  const debounced = useDebounceFn((next: string) => onChange(next.trim()), { wait: 300 });

  // The URL also changes without typing: switching address, or "clear search".
  if (query !== synced) {
    setSynced(query);
    setValue(query);
  }

  const clear = () => {
    debounced.cancel();
    setValue('');
    onChange('');
  };

  return (
    <div {...stylex.props(styles.searchBox)}>
      <Input
        allowClear
        placeholder={t('identity.mailbox.search.placeholder')}
        prefix={<Icon icon={Search} size={14} />}
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          if (next) debounced.run(next);
          else clear();
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') clear();
          if (event.key === 'Enter') {
            debounced.cancel();
            onChange(value.trim());
          }
        }}
      />
      {loading && (
        <div {...stylex.props(styles.progress)}>
          <div {...stylex.props(styles.progressBar)} />
        </div>
      )}
    </div>
  );
};

/**
 * The working column of the mail page: the views, a search, and the rows.
 *
 * Selection is kept per view and search, so moving to another one cannot carry
 * a selection somewhere its rows are not on screen.
 */
const InboxSection = ({
  accountId,
  accountIds,
  agentId,
  disabled,
  onOpen,
  onQueryChange,
  onRemoved,
  onViewChange,
  query,
  selectedId,
  view,
}: InboxSectionProps) => {
  const { t } = useTranslation('setting');
  const list = useMailList({ accountId, agentId, query, view });
  const counts = useMailCounts(accountIds);
  const writes = useMailWritesStore((state) => state.writes);
  const mobile = isMobileSurface();
  const searching = Boolean(query);

  const refresh = () => Promise.all([list.mutate(), counts.mutate()]);
  const actions = useMailActions({
    accountId,
    agentId,
    onRemoved,
    onViewChange,
    refresh,
    searching,
    view,
  });

  const items = useMemo(() => list.items ?? [], [list.items]);

  const scopeKey = `${accountId}:${view}:${query}`;
  const [selection, setSelection] = useState<{ anchor?: string; ids: string[]; scope: string }>({
    ids: [],
    scope: scopeKey,
  });
  const selectedIds = useMemo(
    () => new Set(selection.scope === scopeKey ? selection.ids : []),
    [scopeKey, selection],
  );
  const selectedItems = items.filter((item) => selectedIds.has(item.id));
  const clearSelection = () => setSelection({ ids: [], scope: scopeKey });

  const toggleSelect = (item: MailListItem, shiftKey: boolean) => {
    const next = new Set(selectedIds);
    const anchorIndex = items.findIndex((row) => row.id === selection.anchor);
    if (shiftKey && anchorIndex !== -1) {
      const index = items.findIndex((row) => row.id === item.id);
      const [from, to] = index < anchorIndex ? [index, anchorIndex] : [anchorIndex, index];
      for (const row of items.slice(from, to + 1)) next.add(row.id);
    } else if (next.has(item.id)) {
      next.delete(item.id);
    } else {
      next.add(item.id);
    }
    setSelection({ anchor: item.id, ids: [...next], scope: scopeKey });
  };

  const allSelected = items.length > 0 && selectedItems.length === items.length;

  /** Failed rows stay selected so they can simply be tried again. */
  const runBulk = async (run: () => Promise<{ failed: MailListItem[] }>) => {
    const { failed } = await run();
    setSelection({ ids: failed.map((item) => item.id), scope: scopeKey });
  };

  const deltas = pendingMailDeltas(writes, accountId);
  const serverCounts = accountId ? counts.data?.[accountId] : undefined;
  const unread = Math.max(0, (serverCounts?.unread ?? 0) + deltas.unread);
  const drafts = Math.max(0, (serverCounts?.drafts ?? 0) + deltas.drafts);
  const folderCount: Partial<Record<MailView, number>> = { drafts, inbox: unread };

  const bulkToolbar = (
    <div {...stylex.props(styles.bulkBar)}>
      <Checkbox
        checked={allSelected}
        indeterminate={!allSelected}
        size={14}
        title={t('identity.mailbox.bulk.selectAll')}
        onChange={() =>
          allSelected
            ? clearSelection()
            : setSelection({ ids: items.map((item) => item.id), scope: scopeKey })
        }
      />
      <Text fontSize={13} style={{ flex: 1, paddingInlineStart: 4 }}>
        {t('identity.mailbox.bulk.selected', { count: selectedItems.length })}
      </Text>
      {!searching && view === 'drafts' ? (
        <ActionIcon
          aria-label={t('identity.mailbox.action.discard')}
          icon={X}
          size={'small'}
          title={t('identity.mailbox.action.discard')}
          onClick={() => {
            actions.discard(selectedItems);
            clearSelection();
          }}
        />
      ) : !searching && view === 'trash' ? (
        <>
          <ActionIcon
            aria-label={t('identity.mailbox.action.restore')}
            icon={ArchiveRestore}
            size={'small'}
            title={t('identity.mailbox.action.restore')}
            onClick={() => void runBulk(() => actions.restore(selectedItems))}
          />
          <ActionIcon
            aria-label={t('identity.mailbox.action.purge')}
            icon={Trash2}
            size={'small'}
            title={t('identity.mailbox.action.purge')}
            onClick={() => actions.purge(selectedItems, clearSelection)}
          />
        </>
      ) : (
        <>
          <ActionIcon
            aria-label={t('identity.mailbox.action.markRead')}
            icon={MailOpen}
            size={'small'}
            title={t('identity.mailbox.action.markRead')}
            onClick={() => void runBulk(() => actions.setRead(selectedItems, true))}
          />
          <ActionIcon
            aria-label={t('identity.mailbox.action.markUnread')}
            icon={Mail}
            size={'small'}
            title={t('identity.mailbox.action.markUnread')}
            onClick={() => void runBulk(() => actions.setRead(selectedItems, false))}
          />
          <ActionIcon
            aria-label={t('identity.mailbox.action.star')}
            icon={Star}
            size={'small'}
            title={t('identity.mailbox.action.star')}
            onClick={() => void runBulk(() => actions.setStarred(selectedItems, true))}
          />
          <ActionIcon
            aria-label={t('identity.mailbox.action.delete')}
            icon={Trash2}
            size={'small'}
            title={t('identity.mailbox.action.delete')}
            onClick={() => void runBulk(() => actions.trash(selectedItems))}
          />
        </>
      )}
      <Button size={'small'} type={'text'} onClick={clearSelection}>
        {t('identity.mailbox.bulk.cancel')}
      </Button>
    </div>
  );

  const failure = list.error ? (
    <InlineError
      detail={list.error instanceof Error ? list.error.message : String(list.error)}
      summary={t(searching ? 'identity.mailbox.search.failed' : 'identity.mailbox.loadFailed')}
      onRetry={() => void list.mutate()}
    />
  ) : undefined;

  const renderBody = () => {
    // A failed read is never shown as an empty view.
    if (list.error && !list.items) return failure;

    if (list.isLoading && !list.items) {
      return Array.from({ length: 6 }, (_, index) => (
        <Skeleton height={62} key={index} width={'100%'} />
      ));
    }

    if (items.length === 0) {
      return (
        <>
          {searching ? (
            <Flexbox align={'center'} gap={8} paddingBlock={24}>
              <div className={identityStyles.empty}>
                {t('identity.mailbox.search.empty', { query })}
              </div>
              <Button size={'small'} onClick={() => onQueryChange('')}>
                {t('identity.mailbox.search.clear')}
              </Button>
            </Flexbox>
          ) : (
            <Flexbox paddingBlock={24}>
              <div className={identityStyles.empty}>{t(EMPTY_KEYS[view])}</div>
            </Flexbox>
          )}
          {failure}
        </>
      );
    }

    return (
      <>
        {items.map((item) => (
          <MailRow
            actions={actions}
            active={item.id === selectedId}
            alwaysShowControls={mobile}
            item={item}
            key={item.id}
            readOnly={disabled}
            searching={searching}
            selected={selectedIds.has(item.id)}
            selecting={selectedItems.length > 0}
            view={view}
            onToggleSelect={(shiftKey) => toggleSelect(item, shiftKey)}
            onOpen={() => {
              onOpen(item);
              if (item.isUnread && !disabled) void actions.setRead([item], true);
            }}
          />
        ))}
        {searching && list.truncated && !list.hasMore && (
          <Text fontSize={12} style={{ paddingBlock: 8, textAlign: 'center' }} type={'secondary'}>
            {t('identity.mailbox.search.truncated')}
          </Text>
        )}
        {failure ??
          (list.hasMore && (
            <Button
              block
              loading={list.isLoadingMore}
              size={'small'}
              style={{ flexShrink: 0 }}
              type={'text'}
              onClick={list.loadMore}
            >
              {t('identity.mailbox.loadMore')}
            </Button>
          ))}
      </>
    );
  };

  return (
    <Flexbox flex={1} gap={8} style={{ minHeight: 0 }}>
      <Flexbox horizontal align={'center'} gap={4}>
        <div {...stylex.props(styles.tabs)} role={'tablist'}>
          {MAIL_VIEWS.map((item) => {
            const count = folderCount[item];
            const active = !searching && item === view;
            return (
              <button
                {...stylex.props(styles.tab, active && styles.tabActive)}
                aria-selected={active}
                key={item}
                role={'tab'}
                type={'button'}
                onClick={() => onViewChange(item)}
              >
                {t(FOLDER_KEYS[item])}
                {Boolean(count) && (
                  <span {...stylex.props(styles.tabCount)}>{formatShortenNumber(count!)}</span>
                )}
              </button>
            );
          })}
        </div>
        {view === 'inbox' && !searching && unread > 0 && !disabled && (
          <ActionIcon
            aria-label={t('identity.mailbox.action.markAllRead')}
            icon={CheckCheck}
            size={'small'}
            title={t('identity.mailbox.action.markAllRead')}
            onClick={() =>
              void actions.markAllRead(
                items.filter((item) => item.isUnread),
                unread,
              )
            }
          />
        )}
        {view === 'trash' && !searching && items.length > 0 && !disabled && (
          <ActionIcon
            aria-label={t('identity.mailbox.emptyTrash.confirm')}
            icon={Trash2}
            size={'small'}
            title={t('identity.mailbox.emptyTrash.confirm')}
            onClick={() => actions.emptyTrash(items)}
          />
        )}
        <ActionIcon
          aria-label={t('identity.mailbox.action.refresh')}
          icon={RefreshCw}
          size={'small'}
          title={t('identity.mailbox.action.refresh')}
          onClick={() => void refresh()}
        />
      </Flexbox>
      {selectedItems.length > 0 ? (
        bulkToolbar
      ) : (
        <SearchBox
          loading={searching && list.isValidating}
          query={query}
          onChange={onQueryChange}
        />
      )}
      {/* The list scrolls on its own so the views and search stay in view. */}
      <Flexbox gap={2} {...stylex.props(styles.list)}>
        {renderBody()}
      </Flexbox>
    </Flexbox>
  );
};

export default InboxSection;
