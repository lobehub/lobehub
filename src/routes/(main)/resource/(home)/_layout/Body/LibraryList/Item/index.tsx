import { Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Loader2Icon, LockIcon } from 'lucide-react';
import { type CSSProperties } from 'react';
import React, { memo, useCallback, useMemo } from 'react';

import RepoIcon from '@/components/LibIcon';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';
import { useKnowledgeBaseStore } from '@/store/library';

import Actions from './Actions';
import Editing from './Editing';
import { useDropdownMenu } from './useDropdownMenu';

interface KnowledgeBaseItemProps {
  active?: boolean;
  className?: string;
  description?: string | null;
  id: string;
  name: string;
  style?: CSSProperties;
  userId?: string;
  visibility?: 'private' | 'public';
}

const KnowledgeBaseItem = memo<KnowledgeBaseItemProps>(
  ({ id, name, description, active, style, className, userId, visibility }) => {
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

    // Icon: loader while pending, lock for private KBs, repo icon otherwise.
    // Lock signals "only you can see this" — mirrors the private-agent / private-task visual.
    const icon = useMemo(() => {
      if (isLoading) {
        return <Icon spin color={cssVar.colorTextDescription} icon={Loader2Icon} size={18} />;
      }
      if (visibility === 'private') {
        return <Icon color={cssVar.colorTextDescription} icon={LockIcon} size={18} />;
      }
      return <RepoIcon size={18} />;
    }, [isLoading, visibility]);

    const dropdownMenu = useDropdownMenu({
      description,
      id,
      name,
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
