'use client';

import { Avatar, Icon } from '@lobehub/ui';
import { FileTextIcon, GlobeIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import Actions from '@/features/Pages/PageLayout/Body/List/Item/Actions';
import { useDropdownMenu } from '@/features/Pages/PageLayout/Body/List/Item/useDropdownMenu';
import { pageActions, usePageStore } from '@/store/page';
import type { LobeDocument } from '@/types/document';

import { docsPagePath } from '../../../paths';
import { isArtifactPage } from './group';
import RenameInput from './RenameInput';

const INDENT_PER_LEVEL = 12;

interface PageRowProps {
  depth: number;
  doc: LobeDocument;
  isOpen: boolean;
  onOpen: (id: string) => void;
}

/**
 * One page row. It carries the same actions as the old Pages sidebar — hover
 * menu and right-click menu — because Docs is now the only place a page is
 * listed, so rename / duplicate / delete have to live here. An artifact (an
 * HTML page) takes the chat's HTML-artifact icon so it never reads as text.
 */
const PageRow = memo<PageRowProps>(({ depth, doc, isOpen, onOpen }) => {
  const { t } = useTranslation('file');
  const emoji = doc.metadata?.emoji;
  const title = doc.title || t('pageList.untitled');
  const editing = usePageStore((s) => s.renamingPageId === doc.id);

  const toggleEditing = useCallback(
    (visible?: boolean) => pageActions.setRenamingPageId(visible ? doc.id : null),
    [doc.id],
  );
  const dropdownMenu = useDropdownMenu({ pageId: doc.id, toggleEditing });

  return (
    <NavItem
      actions={<Actions dropdownMenu={dropdownMenu} />}
      active={isOpen}
      contextMenuItems={dropdownMenu}
      // While the field is open the row is not a link: clicks there belong to
      // the field, and an anchor would follow `href` and drop the edit.
      href={editing ? undefined : docsPagePath(doc.id)}
      style={depth ? { paddingInlineStart: 8 + depth * INDENT_PER_LEVEL } : undefined}
      icon={
        emoji ? (
          <Avatar avatar={emoji} size={20} />
        ) : (
          <Icon
            icon={isArtifactPage(doc) ? GlobeIcon : FileTextIcon}
            size={{ size: 16, strokeWidth: 1.5 }}
          />
        )
      }
      title={
        editing ? (
          <RenameInput
            id={doc.id}
            title={title}
            onDone={() => pageActions.setRenamingPageId(null)}
          />
        ) : (
          title
        )
      }
      onClick={() => {
        // While the inline field is open a click belongs to the input, not to
        // navigation — opening the page here would drop the edit.
        if (editing) return;
        onOpen(doc.id);
      }}
    />
  );
});

PageRow.displayName = 'PageRow';

export default PageRow;
