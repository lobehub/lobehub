import { canWorkspaceRoleBeTaskAssignee } from '@lobechat/const/rbac';
import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { Popover, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { UserRoundX } from 'lucide-react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useFetchWorkspaceMembers } from '@/business/client/hooks/useFetchWorkspaceMembers';
import { useWorkspaceMembers } from '@/business/client/hooks/useWorkspaceMembers';
import Avatar from '@/components/Avatar';
import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { usePermission } from '@/hooks/usePermission';
import { useTaskStore } from '@/store/task';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { hasWorkspaceMemberDirectory } from '../shared/memberAssigneeMode';

interface AssigneeMemberSelectorProps {
  children: ReactNode;
  currentUserId?: string | null;
  disabled?: boolean;
  fullWidth?: boolean;
  onChange?: (userId: string | null) => void;
  taskCreatorId?: string | null;
  taskIdentifier?: string;
  taskVisibility?: 'private' | 'public' | null;
}

type WorkspaceMemberRow = ReturnType<typeof useWorkspaceMembers>[number];
type MemberOption =
  | { key: 'unassigned'; kind: 'unassigned' }
  | { key: string; kind: 'member'; member: WorkspaceMemberRow };

const styles = createStaticStyles(({ css, cssVar }) => ({
  searchInput: css`
    width: 100%;
    padding-block: 6px;
    padding-inline: 10px;
    border: none;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font-family: inherit;
    font-size: 13px;
    color: ${cssVar.colorText};

    background: transparent;
    outline: none;

    &::placeholder {
      color: ${cssVar.colorTextPlaceholder};
    }
  `,
  sectionHeader: css`
    padding-block: 4px;
    padding-inline: 8px;

    font-size: 12px;
    line-height: 1.4;
    color: ${cssVar.colorTextTertiary};
  `,
}));

const memberName = (member: WorkspaceMemberRow) =>
  member.user?.fullName?.trim() ||
  member.user?.username?.trim() ||
  member.user?.email?.trim() ||
  member.userId;

const matchesSearch = (member: WorkspaceMemberRow, query: string) =>
  [member.user?.fullName, member.user?.username, member.user?.email].some((label) =>
    (label ?? '').toLowerCase().includes(query),
  );

const triggerStyle: CSSProperties = {
  alignItems: 'center',
  display: 'inline-flex',
  justifyContent: 'center',
  lineHeight: 1,
  maxWidth: '100%',
  minWidth: 0,
};

const AssigneeMemberSelector = memo<AssigneeMemberSelectorProps>(
  ({
    children,
    currentUserId,
    disabled,
    fullWidth,
    onChange,
    taskCreatorId,
    taskIdentifier,
    taskVisibility,
  }) => {
    const { t } = useTranslation('chat');
    const { allowed: canEditTask, reason } = usePermission('create_content');
    const [key, setKey] = useState(0);
    const [search, setSearch] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    const updateTask = useTaskStore((state) => state.updateTask);
    const activeWorkspaceId = useActiveWorkspaceId();
    const { isLoading } = useFetchWorkspaceMembers();
    const allMembers = useWorkspaceMembers();
    const selfUserId = useUserStore(userProfileSelectors.userId);
    const creatorId = taskCreatorId ?? selfUserId;
    const members = useMemo(() => {
      // Personal mode has no member directory. Keep only the explicit
      // unassigned option so an existing self-assignment can still be cleared
      // without leaking a stale workspace member list into this picker.
      if (!hasWorkspaceMemberDirectory(activeWorkspaceId)) return [];

      const assignableMembers = allMembers.filter((member) =>
        canWorkspaceRoleBeTaskAssignee(member.role),
      );
      return taskVisibility === 'private'
        ? assignableMembers.filter((member) => member.userId === creatorId)
        : assignableMembers;
    }, [activeWorkspaceId, allMembers, creatorId, taskVisibility]);

    const query = search.trim().toLowerCase();
    const filteredMembers = useMemo(
      () => (query ? members.filter((member) => matchesSearch(member, query)) : members),
      [members, query],
    );
    const unassignedLabel = t('taskList.unassigned');
    const showUnassigned = !query || unassignedLabel.toLowerCase().includes(query);
    const flatOptions = useMemo<MemberOption[]>(
      () => [
        ...(showUnassigned ? [{ key: 'unassigned', kind: 'unassigned' } as const] : []),
        ...filteredMembers.map(
          (member) => ({ key: `member:${member.userId}`, kind: 'member', member }) as const,
        ),
      ],
      [filteredMembers, showUnassigned],
    );
    const optionIndexByKey = useMemo(
      () => new Map(flatOptions.map((option, index) => [option.key, index])),
      [flatOptions],
    );
    const selectedKey = currentUserId ? `member:${currentUserId}` : 'unassigned';

    useEffect(() => {
      if (query) {
        setActiveIndex(0);
        return;
      }
      const selectedIndex = optionIndexByKey.get(selectedKey);
      setActiveIndex(selectedIndex ?? 0);
    }, [optionIndexByKey, query, selectedKey]);

    const handleMemberChange = useCallback(
      (userId: string | null) => {
        if (!canEditTask || userId === (currentUserId ?? null)) return;
        setKey((value) => value + 1);
        setSearch('');
        if (onChange) {
          onChange(userId);
          return;
        }
        if (taskIdentifier) void updateTask(taskIdentifier, { assigneeUserId: userId });
      },
      [canEditTask, currentUserId, onChange, taskIdentifier, updateTask],
    );

    const handleSelect = useCallback(
      (option: MemberOption) =>
        handleMemberChange(option.kind === 'member' ? option.member.userId : null),
      [handleMemberChange],
    );

    const handleSearchKeyDown = useCallback(
      (event: KeyboardEvent<HTMLInputElement>) => {
        if (flatOptions.length === 0) return;
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setActiveIndex((index) => (index + 1) % flatOptions.length);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          setActiveIndex((index) => (index - 1 + flatOptions.length) % flatOptions.length);
        } else if (event.key === 'Enter') {
          event.preventDefault();
          const target = flatOptions[activeIndex];
          if (target) handleSelect(target);
        }
      },
      [activeIndex, flatOptions, handleSelect],
    );

    useEffect(() => {
      const active = listRef.current?.querySelector<HTMLElement>(
        `[data-assignee-index="${activeIndex}"]`,
      );
      active?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex]);

    const renderOption = (option: MemberOption) => {
      const optionIndex = optionIndexByKey.get(option.key) ?? 0;
      const active = optionIndex === activeIndex;
      const member = option.kind === 'member' ? option.member : undefined;
      return (
        <div
          data-assignee-index={optionIndex}
          key={option.key}
          onMouseEnter={() => setActiveIndex(optionIndex)}
        >
          <NavItem
            active={active}
            style={{ flexShrink: 0 }}
            title={member ? memberName(member) : unassignedLabel}
            icon={
              member ? (
                <Avatar
                  avatar={member.user?.avatar || undefined}
                  name={memberName(member)}
                  shape={'circle'}
                  size={22}
                />
              ) : (
                <Icon color={cssVar.colorTextDescription} icon={UserRoundX} size={18} />
              )
            }
            onClick={() => handleSelect(option)}
          />
        </div>
      );
    };

    const blocked = disabled || !canEditTask;
    const currentTriggerStyle = fullWidth ? { ...triggerStyle, width: '100%' } : triggerStyle;
    const trigger = blocked ? (
      <Tooltip title={disabled ? t('taskDetail.reassignDisabled') : reason}>
        <div
          style={{ ...currentTriggerStyle, cursor: 'not-allowed', opacity: 0.5 }}
          onClick={(event) => event.stopPropagation()}
        >
          <span style={{ pointerEvents: 'none' }}>{children}</span>
        </div>
      </Tooltip>
    ) : (
      <div style={currentTriggerStyle} onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    );

    return (
      <Popover
        disabled={blocked}
        key={key}
        placement={'bottomLeft'}
        styles={{ content: { padding: 0, width: 260 } }}
        trigger={'click'}
        content={
          <Flexbox onClick={(event) => event.stopPropagation()}>
            {activeWorkspaceId && (
              <input
                autoFocus
                className={styles.searchInput}
                placeholder={t('taskList.assigneeSearch.memberPlaceholder')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={handleSearchKeyDown}
              />
            )}
            {activeWorkspaceId && isLoading ? (
              <SkeletonList rows={6} />
            ) : flatOptions.length === 0 ? (
              <Flexbox align={'center'} justify={'center'} padding={16}>
                <Text fontSize={12} type={'secondary'}>
                  {t('taskList.assigneeSearch.memberEmpty')}
                </Text>
              </Flexbox>
            ) : (
              <Flexbox
                gap={4}
                padding={8}
                ref={listRef}
                style={{ maxHeight: '50vh', overflowY: 'auto', width: '100%' }}
              >
                {showUnassigned && renderOption({ key: 'unassigned', kind: 'unassigned' })}
                {filteredMembers.length > 0 && (
                  <div className={styles.sectionHeader}>
                    {t('taskList.assigneeSelector.memberGroup')}
                  </div>
                )}
                {filteredMembers.map((member) =>
                  renderOption({ key: `member:${member.userId}`, kind: 'member', member }),
                )}
              </Flexbox>
            )}
          </Flexbox>
        }
      >
        {trigger}
      </Popover>
    );
  },
);

export default AssigneeMemberSelector;
