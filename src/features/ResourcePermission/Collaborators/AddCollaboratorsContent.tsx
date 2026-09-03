'use client';

import { MAX_RESOURCE_COLLABORATORS_PER_ADD } from '@lobechat/const';
import { Empty, Flexbox, Icon, SearchBar } from '@lobehub/ui';
import {
  Avatar,
  Button,
  SkeletonAvatar,
  SkeletonText,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { useHover } from 'ahooks';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { CheckIcon, SearchXIcon, UsersIcon } from 'lucide-react';
import { memo, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFetchWorkspaceMembers } from '@/business/client/hooks/useFetchWorkspaceMembers';
import { useWorkspaceMembers } from '@/business/client/hooks/useWorkspaceMembers';
import type { PermissionResourceType, ResourceAccessLevel } from '@/services/resourcePermission';

import { useResourceCollaborators } from '../useResourceCollaborators';
import { useResourcePermission } from '../useResourcePermission';

const styles = createStaticStyles(({ css }) => ({
  footer: css`
    padding-block: 12px;
    padding-inline: 20px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  header: css`
    padding-block: 4px 12px;
    padding-inline: 20px;
  `,
  list: css`
    user-select: none;

    overflow-y: auto;

    /* Fill toward 360px, but yield on short viewports so the footer never
       leaves the screen; 240px keeps ~4 rows visible as the floor. */
    height: clamp(240px, calc(100dvh - 320px), 360px);
    padding-block: 0 8px;
    padding-inline: 12px;
  `,
  row: css`
    cursor: pointer;

    margin-block: 2px;
    padding-block: 10px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};

    transition: background 0.2s ease;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  rowIndicator: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;

    margin-inline-start: auto;
    padding-inline-start: 8px;

    color: ${cssVar.colorPrimary};
  `,
  rowSelected: css`
    background: ${cssVar.colorFillQuaternary};
  `,
}));

/**
 * Structural shape shared by the OSS stub's membership rows and the cloud
 * store's RBAC-projected rows — the business-slot module does not export a
 * common type, and each side names its own.
 */
interface MemberCandidate {
  role?: string | null;
  user?: {
    avatar?: string | null;
    email?: string | null;
    fullName?: string | null;
    username?: string | null;
  } | null;
  userId: string;
}

const memberName = (member: MemberCandidate) =>
  member.user?.fullName || member.user?.username || member.user?.email || member.userId;

/**
 * Workspace admins hold `:all` update capability and bypass Member
 * Permissions entirely, so offering them as collaborator targets would
 * present a control that changes nothing.
 */
const PRIVILEGED_ROLES = new Set(['admin', 'owner']);

const MemberRow = memo<{
  member: MemberCandidate;
  onToggle: (userId: string) => void;
  selected: boolean;
}>(({ member, onToggle, selected }) => {
  const ref = useRef(null);
  const isHovering = useHover(ref);

  const name = memberName(member);
  const email = member.user?.email;

  return (
    <Flexbox
      horizontal
      align={'center'}
      aria-selected={selected}
      className={cx(styles.row, selected && styles.rowSelected)}
      gap={12}
      ref={ref}
      role={'option'}
      tabIndex={0}
      onClick={() => onToggle(member.userId)}
      onKeyDown={(e) => {
        // Focus lands here by Tab out of the search field; Enter and Space are
        // what a listbox option is expected to answer to. Space would scroll
        // the list without the preventDefault.
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onToggle(member.userId);
      }}
    >
      <Avatar
        animation={isHovering}
        avatar={member.user?.avatar || undefined}
        size={40}
        title={name}
      />
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Text ellipsis weight={500}>
          {name}
        </Text>
        {email && email !== name ? (
          <Text ellipsis fontSize={12} type={'secondary'}>
            {email}
          </Text>
        ) : null}
      </Flexbox>
      {/* Select-option style: the selected state reads as a primary check on
          the trailing edge, mirroring base-ui Select's ItemIndicator. */}
      {selected ? (
        <span className={styles.rowIndicator}>
          <Icon icon={CheckIcon} size={'small'} />
        </span>
      ) : null}
    </Flexbox>
  );
});

MemberRow.displayName = 'AddCollaboratorMemberRow';

interface AddCollaboratorsContentProps {
  /** The level a new collaborator receives — single-level per resource type today. */
  grantLevel: ResourceAccessLevel;
  resourceId: string;
  resourceType: PermissionResourceType;
}

const AddCollaboratorsContent = memo<AddCollaboratorsContentProps>(
  ({ grantLevel, resourceId, resourceType }) => {
    const { t } = useTranslation('setting');
    const { close } = useModalContext();

    const { isLoading: membersLoading } = useFetchWorkspaceMembers();
    const members: MemberCandidate[] = useWorkspaceMembers();
    const { data: permission } = useResourcePermission(resourceType, resourceId);
    const { addCollaborators, collaborators, mutating } = useResourceCollaborators(
      resourceType,
      resourceId,
    );

    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState<string[]>([]);

    const candidates = useMemo(() => {
      const existing = new Set((collaborators ?? []).map((item) => item.userId));
      const list = members.filter((member) => {
        if (member.role && PRIVILEGED_ROLES.has(member.role)) return false;
        if (member.userId === permission?.creatorId) return false;
        return !existing.has(member.userId);
      });
      // Large workspaces list dozens of members — a stable alphabetical order
      // makes the list scannable beyond what search alone covers.
      return list.sort((a, b) => memberName(a).localeCompare(memberName(b)));
    }, [members, collaborators, permission?.creatorId]);

    const filtered = useMemo(() => {
      const keyword = query.trim().toLowerCase();
      if (!keyword) return candidates;
      return candidates.filter((member) =>
        [member.user?.fullName, member.user?.username, member.user?.email]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(keyword)),
      );
    }, [candidates, query]);

    const toggle = (userId: string) => {
      if (selected.includes(userId)) {
        setSelected((prev) => prev.filter((id) => id !== userId));
        return;
      }
      // The procedure refuses a longer batch outright, so stop the selection at
      // the cap and say why — otherwise the whole hand-assembled selection is
      // rejected at confirm time, after the work of making it.
      if (selected.length >= MAX_RESOURCE_COLLABORATORS_PER_ADD) {
        toast.warning(
          t('permission.collaborators.addModal.selectionLimit', {
            count: MAX_RESOURCE_COLLABORATORS_PER_ADD,
          }),
        );
        return;
      }
      setSelected((prev) => [...prev, userId]);
    };

    const handleConfirm = async () => {
      // Only dismiss once the grant actually landed — the hook reports failure
      // through a toast, and closing anyway would discard the selection while
      // adding nobody.
      const added = await addCollaborators(selected, grantLevel);
      if (added) close();
    };

    const isInitialLoading = membersLoading && members.length === 0;
    // A zero-result search must read as "no match", never as the first-run
    // "nobody to add" state — they call for different user reactions.
    const isSearchMiss = filtered.length === 0 && candidates.length > 0;

    return (
      <Flexbox>
        <Flexbox className={styles.header}>
          <SearchBar
            autoFocus
            placeholder={t('permission.collaborators.addModal.search')}
            value={query}
            variant={'filled'}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Flexbox>
        <Flexbox
          aria-multiselectable
          aria-label={t('permission.collaborators.addModal.title')}
          className={styles.list}
          role={'listbox'}
        >
          {isInitialLoading ? (
            [0, 1, 2].map((key) => (
              <Flexbox horizontal align={'center'} className={styles.row} gap={12} key={key}>
                <SkeletonAvatar size={40} />
                <SkeletonText style={{ marginBottom: 0, width: 180 }} />
              </Flexbox>
            ))
          ) : filtered.length === 0 ? (
            <Empty
              icon={isSearchMiss ? SearchXIcon : UsersIcon}
              paddingBlock={48}
              description={t(
                isSearchMiss
                  ? 'permission.collaborators.addModal.noMatch'
                  : 'permission.collaborators.addModal.empty',
              )}
            />
          ) : (
            filtered.map((member) => (
              <MemberRow
                key={member.userId}
                member={member}
                selected={selected.includes(member.userId)}
                onToggle={toggle}
              />
            ))
          )}
        </Flexbox>
        <Flexbox horizontal align={'center'} className={styles.footer} gap={8}>
          <Flexbox flex={1}>
            {selected.length > 0 ? (
              <Text fontSize={13} type={'secondary'}>
                {t('permission.collaborators.addModal.selectedCount', { count: selected.length })}
              </Text>
            ) : null}
          </Flexbox>
          <Button onClick={() => close()}>{t('cancel', { ns: 'common' })}</Button>
          <Button
            disabled={selected.length === 0}
            loading={mutating}
            type={'primary'}
            onClick={handleConfirm}
          >
            {selected.length > 0
              ? t('permission.collaborators.addModal.confirmCount', { count: selected.length })
              : t('permission.collaborators.addModal.confirm')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

AddCollaboratorsContent.displayName = 'AddCollaboratorsContent';

export default AddCollaboratorsContent;
