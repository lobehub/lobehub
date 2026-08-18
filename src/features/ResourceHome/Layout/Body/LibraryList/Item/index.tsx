import { Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Loader2Icon } from 'lucide-react';
import { type CSSProperties } from 'react';
import React, { memo, useCallback, useMemo } from 'react';

import LibraryStatusIcon from '@/components/LibIcon/StatusIcon';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useKnowledgeBaseStore } from '@/store/library';

import Actions from './Actions';
import Editing from './Editing';
import { useDropdownMenu } from './useDropdownMenu';

interface KnowledgeBaseItemProps {
  active?: boolean;
  className?: string;
  description?: string | null;
  id: string;
  memberRestricted?: boolean;
  name: string;
  permissionManageable?: boolean;
  style?: CSSProperties;
  userId?: string;
  visibility?: 'private' | 'public';
}

const KnowledgeBaseItem = memo<KnowledgeBaseItemProps>(
  ({
    id,
    name,
    description,
    active,
    style,
    className,
    userId,
    visibility,
    memberRestricted,
    permissionManageable,
  }) => {
    const setLibraryId = useResourceManagerStore((s) => s.setLibraryId);
    const navigate = useWorkspaceAwareNavigate();
    const { allowed: canEdit } = usePermission('edit_own_content');

    const [editing, isLoading] = useKnowledgeBaseStore((s) => [
      s.knowledgeBaseRenamingId === id,
      s.knowledgeBaseLoadingIds.includes(id),
    ]);

    const toggleEditing = useCallback(
      (visible?: boolean) => {
        useKnowledgeBaseStore.setState(
          { knowledgeBaseRenamingId: visible ? id : null },
          false,
          'toggleEditing',
        );
      },
      [id],
    );

    const handleClick = useCallback(() => {
      if (!editing) {
        navigate(`/resource/library/${id}`);
        setLibraryId(id);
      }
    }, [editing, navigate, id, setLibraryId]);

    const handleDoubleClick = useCallback(
      (e: React.MouseEvent) => {
        if (e.altKey && canEdit) {
          toggleEditing(true);
        }
      },
      [canEdit, toggleEditing],
    );

    // Restricted (No-access) KBs are invisible to plain members, so this row
    // only renders for managers — the lock tells them at a glance which shared
    // KBs members cannot open. The flag rides on the list query, so it costs
    // no per-row permission request.
    const isMemberRestricted = visibility === 'public' && !!memberRestricted;

    // Keep the same private / restricted / workspace icon language as the
    // active-library header and its switcher.
    const icon = useMemo(() => {
      if (isLoading) {
        return <Icon spin color={cssVar.colorTextDescription} icon={Loader2Icon} size={18} />;
      }

      return (
        <LibraryStatusIcon
          memberRestricted={isMemberRestricted}
          size={18}
          visibility={visibility}
        />
      );
    }, [isLoading, visibility, isMemberRestricted]);

    const dropdownMenu = useDropdownMenu({
      description,
      id,
      name,
      permissionManageable,
      toggleEditing,
      userId,
      visibility,
    });

    return (
      <div style={{ position: 'relative' }}>
        <NavItem
          actions={<Actions dropdownMenu={dropdownMenu} />}
          active={active}
          className={className}
          contextMenuItems={dropdownMenu}
          disabled={editing}
          icon={icon}
          key={id}
          loading={isLoading}
          style={style}
          title={editing ? <Editing id={id} name={name} toggleEditing={toggleEditing} /> : name}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
        />
      </div>
    );
  },
);

export default KnowledgeBaseItem;
