import { Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Loader2Icon } from 'lucide-react';
import { type CSSProperties } from 'react';
import React, { memo, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import RepoIcon from '@/components/LibIcon';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useKnowledgeBaseStore } from '@/store/library';

import Actions from './Actions';
import Editing from './Editing';
import { useDropdownMenu } from './useDropdownMenu';

interface KnowledgeBaseItemProps {
  active?: boolean;
  className?: string;
  id: string;
  name: string;
  style?: CSSProperties;
}

const KnowledgeBaseItem = memo<KnowledgeBaseItemProps>(({ id, name, active, style, className }) => {
  const setLibraryId = useResourceManagerStore((s) => s.setLibraryId);
  const navigate = useNavigate();

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
  }, [editing, navigate, id]);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.altKey) {
        toggleEditing(true);
      }
    },
    [toggleEditing],
  );

  // Icon (show loader when updating)
  const icon = useMemo(() => {
    if (isLoading) {
      return <Icon spin color={cssVar.colorTextDescription} icon={Loader2Icon} size={18} />;
    }
    return <RepoIcon size={18} />;
  }, [isLoading]);

  const dropdownMenu = useDropdownMenu({
    id,
    toggleEditing,
  });

  return (
    <>
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
        title={name}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      />
      <Editing id={id} name={name} toggleEditing={toggleEditing} />
    </>
  );
});

export default KnowledgeBaseItem;
