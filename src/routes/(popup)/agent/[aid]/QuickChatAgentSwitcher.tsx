'use client';

import { INBOX_SESSION_ID } from '@lobechat/const';
import { agentDisplayName } from '@lobechat/types';
import { Flexbox, Icon, Input, Popover, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AgentAvatar from '@/components/AgentAvatar';
import { DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { type SidebarAgentItem } from '@/database/repositories/home';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

const VISIBLE_LIMIT = 5;
const AVATAR_SIZE = 30;

interface SwitchItem {
  avatar?: string;
  background?: string;
  id: string;
  isInbox?: boolean;
  navId: string;
  title: string;
}

const styles = stylex.create({
  active: {
    borderColor: cssVar.colorPrimary,
    boxShadow: `0 0 0 2px ${cssVar.colorPrimaryBgHover}`,
  },
  itemBtn: {
    cursor: 'pointer',
    boxSizing: 'content-box',
    padding: '0',
    borderWidth: '1.5px',
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderRadius: '8px',
    opacity: { 'default': 0.65, ':hover': 1 },
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    transition: 'opacity 0.15s,\n      border-color 0.15s,\n      box-shadow 0.15s',
  },
  more: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: `${AVATAR_SIZE}px`,
    height: `${AVATAR_SIZE}px`,
    borderWidth: '1.5px',
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderRadius: '8px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': cssVar.colorFillTertiary, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
  popover: { padding: '0' },
  popoverContent: { width: '240px', padding: '8px' },
  popoverEmpty: {
    paddingBlock: '16px',
    paddingInline: '8px',
    color: cssVar.colorTextTertiary,
    textAlign: 'center',
  },
  popoverList: { overflow: 'auto', maxHeight: '240px' },
  popoverRow: {
    cursor: 'pointer',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    paddingBlock: '6px',
    paddingInline: '8px',
    borderRadius: '6px',
    color: cssVar.colorText,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
});

const useSwitchItems = (): SwitchItem[] => {
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const inboxMeta = useAgentStore(
    (s) => (inboxAgentId ? agentSelectors.getAgentMetaById(inboxAgentId)(s) : undefined),
    isEqual,
  );
  const pinned = useHomeStore(homeAgentListSelectors.pinnedAgents, isEqual);
  const recent = useHomeStore(homeAgentListSelectors.ungroupedAgents, isEqual);

  return useMemo(() => {
    const inbox: SwitchItem = {
      avatar: inboxMeta?.avatar || DEFAULT_INBOX_AVATAR,
      background: inboxMeta?.backgroundColor,
      id: INBOX_SESSION_ID,
      isInbox: true,
      navId: INBOX_SESSION_ID,
      title: agentDisplayName(inboxMeta, 'Inbox'),
    };

    const fromAgent = (a: SidebarAgentItem): SwitchItem => ({
      avatar: typeof a.avatar === 'string' ? a.avatar : undefined,
      background: a.backgroundColor || undefined,
      id: a.id,
      navId: a.id,
      title: agentDisplayName(a, 'Untitled'),
    });

    const isAgent = (a: SidebarAgentItem): boolean => a.type === 'agent';

    const merged = [
      inbox,
      ...pinned.filter(isAgent).map(fromAgent),
      ...recent.filter(isAgent).map(fromAgent),
    ];

    const seen = new Set<string>();
    return merged.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [inboxMeta, pinned, recent]);
};

const QuickChatAgentSwitcher = memo(() => {
  // Popup window has its own SPA boot — main sidebar's fetch never fires here,
  // so we trigger the agent list fetch ourselves.
  useFetchAgentList();

  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const { aid } = useParams<{ aid: string }>();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const items = useSwitchItems();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [search, setSearch] = useState('');

  const visible = items.slice(0, VISIBLE_LIMIT);
  const remaining = items.slice(VISIBLE_LIMIT);

  const filteredRemaining = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return remaining;
    return remaining.filter((i) => i.title.toLowerCase().includes(q));
  }, [remaining, search]);

  const isActive = (item: SwitchItem) => {
    if (item.isInbox) return aid === INBOX_SESSION_ID || aid === inboxAgentId;
    return aid === item.id;
  };

  const handleSelect = (item: SwitchItem) => {
    setPopoverOpen(false);
    setSearch('');
    if (isActive(item)) return;
    navigate(`/popup/agent/${item.navId}`, { replace: true });
  };

  const isReady = useHomeStore(homeAgentListSelectors.isAgentListInit);
  if (!isReady) return null;

  return (
    <Flexbox horizontal align={'center'} gap={6} justify={'flex-start'}>
      {visible.map((item) => (
        <Tooltip key={item.id} title={item.title}>
          <button
            aria-label={item.title}
            {...stylex.props(styles.itemBtn, isActive(item) && styles.active)}
            type={'button'}
            onClick={() => handleSelect(item)}
          >
            <AgentAvatar
              agentId={item.id}
              avatar={item.avatar}
              background={item.background}
              name={item.title}
              size={AVATAR_SIZE}
            />
          </button>
        </Tooltip>
      ))}
      {remaining.length > 0 && (
        <Popover
          arrow={false}
          classNames={{ content: stylex.props(styles.popover).className }}
          open={popoverOpen}
          placement={'bottom'}
          trigger={'click'}
          content={
            <div {...stylex.props(styles.popoverContent)}>
              <Input
                allowClear
                placeholder={t('quickChatSwitcher.searchPlaceholder')}
                size={'small'}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className={stylex.props(styles.popoverList).className} style={{ marginTop: 8 }}>
                {filteredRemaining.length === 0 ? (
                  <div {...stylex.props(styles.popoverEmpty)}>{t('quickChatSwitcher.empty')}</div>
                ) : (
                  filteredRemaining.map((item) => (
                    <div
                      {...stylex.props(styles.popoverRow)}
                      key={item.id}
                      onClick={() => handleSelect(item)}
                    >
                      <AgentAvatar
                        agentId={item.id}
                        avatar={item.avatar}
                        background={item.background}
                        name={item.title}
                        size={22}
                      />
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.title}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          }
          onOpenChange={setPopoverOpen}
        >
          <button
            aria-label={t('quickChatSwitcher.more')}
            {...stylex.props(styles.more)}
            type={'button'}
          >
            <Icon icon={MoreHorizontalIcon} size={16} />
          </button>
        </Popover>
      )}
    </Flexbox>
  );
});

QuickChatAgentSwitcher.displayName = 'QuickChatAgentSwitcher';

export default QuickChatAgentSwitcher;
