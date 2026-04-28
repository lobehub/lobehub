'use client';

import { INBOX_SESSION_ID } from '@lobechat/const';
import { Avatar, Flexbox, Icon, Input, Popover, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { DEFAULT_AVATAR, DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { type SidebarAgentItem } from '@/database/repositories/home';
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

const styles = createStaticStyles(({ css, cssVar }) => ({
  active: css`
    border-color: ${cssVar.colorPrimary};
    box-shadow: 0 0 0 2px ${cssVar.colorPrimaryBgHover};
  `,
  itemBtn: css`
    cursor: pointer;

    box-sizing: content-box;
    padding: 0;
    border: 1.5px solid transparent;
    border-radius: 8px;

    opacity: 0.65;
    background: transparent;

    transition:
      opacity 0.15s,
      border-color 0.15s,
      box-shadow 0.15s;

    &:hover {
      opacity: 1;
    }
  `,
  more: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: ${AVATAR_SIZE}px;
    height: ${AVATAR_SIZE}px;
    border: 1.5px solid transparent;
    border-radius: 8px;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  popover: css`
    padding: 0;
  `,
  popoverContent: css`
    width: 240px;
    padding: 8px;
  `,
  popoverEmpty: css`
    padding-block: 16px;
    padding-inline: 8px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  popoverList: css`
    overflow: auto;
    max-height: 240px;
  `,
  popoverRow: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 8px;
    border-radius: 6px;

    color: ${cssVar.colorText};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
}));

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
      title: inboxMeta?.title || 'Inbox',
    };

    const fromAgent = (a: SidebarAgentItem): SwitchItem => ({
      avatar: typeof a.avatar === 'string' ? a.avatar : DEFAULT_AVATAR,
      background: a.backgroundColor || undefined,
      id: a.id,
      navId: a.id,
      title: a.title || 'Untitled',
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

  const navigate = useNavigate();
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
            className={cx(styles.itemBtn, isActive(item) && styles.active)}
            type={'button'}
            onClick={() => handleSelect(item)}
          >
            <Avatar
              avatar={item.avatar}
              background={item.background}
              shape={'square'}
              size={AVATAR_SIZE}
            />
          </button>
        </Tooltip>
      ))}
      {remaining.length > 0 && (
        <Popover
          arrow={false}
          classNames={{ content: styles.popover }}
          open={popoverOpen}
          placement={'bottom'}
          trigger={'click'}
          content={
            <div className={styles.popoverContent}>
              <Input
                allowClear
                placeholder={'Search agents...'}
                size={'small'}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className={styles.popoverList} style={{ marginTop: 8 }}>
                {filteredRemaining.length === 0 ? (
                  <div className={styles.popoverEmpty}>No agents found</div>
                ) : (
                  filteredRemaining.map((item) => (
                    <div
                      className={styles.popoverRow}
                      key={item.id}
                      onClick={() => handleSelect(item)}
                    >
                      <Avatar
                        avatar={item.avatar}
                        background={item.background}
                        shape={'square'}
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
          <button aria-label={'More agents'} className={styles.more} type={'button'}>
            <Icon icon={MoreHorizontalIcon} size={16} />
          </button>
        </Popover>
      )}
    </Flexbox>
  );
});

QuickChatAgentSwitcher.displayName = 'QuickChatAgentSwitcher';

export default QuickChatAgentSwitcher;
