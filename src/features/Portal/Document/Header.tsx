'use client';

import { buildAgentDocumentUrl } from '@lobechat/builtin-tool-agent-documents';
import { Flexbox, Icon } from '@lobehub/ui';
import {
  ActionIcon,
  type DropdownItem,
  DropdownMenu,
  Skeleton,
  Text,
  toast,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRight, Link2, MoreHorizontal, Pencil } from 'lucide-react';
import { type ChangeEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useClientDataSWR } from '@/libs/swr';
import { portalKeys } from '@/libs/swr/keys';
import { documentService } from '@/services/document';
import { useAgentStore } from '@/store/agent';
import { getDocumentRenderMode } from '@/utils/documentRenderMode';

import AutoSaveHint from './AutoSaveHint';
import { useResolvedDocumentId } from './documentViewContext';

const TITLE_MAX_LENGTH = 100;

const styles = createStaticStyles(({ css }) => ({
  crumb: css`
    cursor: pointer;
    flex-shrink: 0;
    font-size: 13px;
    transition: color ${cssVar.motionDurationFast} ${cssVar.motionEaseInOut};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  root: css`
    flex: 1;
    min-width: 0;
  `,
  separator: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextQuaternary};
  `,
  title: css`
    cursor: text;
    font-size: 13px;
    font-weight: 600;
  `,
  titleInput: css`
    flex: 1;

    min-width: 0;
    padding: 0;
    border: none;

    font: inherit;
    font-size: 13px;
    font-weight: 600;
    text-align: start;

    background: transparent;
    outline: none;
  `,
}));

interface HeaderProps {
  /** Navigate to the documents index on breadcrumb click (agent route has one). */
  onOpenDocumentsIndex?: () => void;
}

const Header = memo<HeaderProps>(({ onOpenDocumentsIndex }) => {
  const { t } = useTranslation(['chat', 'file', 'common']);
  const documentId = useResolvedDocumentId();
  // The doc-anchored chat topic binds (agentId, documentId); the standalone
  // route for "copy link" needs the owning agent id, which equals the store's
  // activeAgentId inside this portal (see Body's panelEligible gate).
  const agentId = useAgentStore((s) => s.activeAgentId);
  const appOrigin = useAppOrigin();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();

  const {
    data: document,
    isLoading,
    mutate: mutateDocument,
  } = useClientDataSWR(documentId ? portalKeys.documentHeader(documentId) : null, () =>
    documentService.getDocumentById(documentId!),
  );

  const savedTitle = useMemo(
    () => document?.title || document?.filename || '',
    [document?.title, document?.filename],
  );
  const isReadonly = !!document && getDocumentRenderMode(document).mode === 'highlight';

  const [draft, setDraft] = useState(savedTitle);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Follow the SWR source while idle; never clobber a draft mid-typing.
  useEffect(() => {
    if (!editing) setDraft(savedTitle);
  }, [editing, savedTitle]);

  const startEdit = useCallback(() => {
    if (isReadonly) return;
    setDraft(savedTitle);
    setEditing(true);
    // The input mounts during this render; focus once it exists.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isReadonly, savedTitle]);

  const commitEdit = useCallback(async () => {
    setEditing(false);
    const nextTitle = draft.trim();
    // Empty or unchanged drafts fall back to the saved title — no write.
    if (!nextTitle || nextTitle === savedTitle || !documentId) {
      setDraft(savedTitle);
      return;
    }

    // Optimistic update, then reconcile with the server response.
    setDraft(nextTitle);
    mutateDocument((prev) => (prev ? { ...prev, title: nextTitle } : prev), { revalidate: false });
    try {
      await documentService.updateDocument({ id: documentId, title: nextTitle });
    } catch {
      toast.error(t('operationFailed', { ns: 'common' }));
      setDraft(savedTitle);
      mutateDocument((prev) => (prev ? { ...prev, title: savedTitle } : prev), {
        revalidate: false,
      });
    }
  }, [draft, documentId, mutateDocument, savedTitle, t]);

  const handleTitleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        // blur commits; Escape restores first so the blur writes nothing new.
        event.preventDefault();
        inputRef.current?.blur();
      } else if (event.key === 'Escape') {
        setDraft(savedTitle);
        setEditing(false);
      }
    },
    [savedTitle],
  );

  const menuItems = useMemo<DropdownItem[]>(() => {
    const items: DropdownItem[] = [];

    if (documentId && !isReadonly) {
      items.push({
        icon: <Icon icon={Pencil} />,
        key: 'rename',
        label: t('rename', { ns: 'common' }),
        onClick: startEdit,
      });
    }

    if (documentId && agentId) {
      items.push({
        icon: <Icon icon={Link2} />,
        key: 'copy-link',
        label: t('pageEditor.menu.copyLink', { ns: 'file' }),
        onClick: async () => {
          const url = buildAgentDocumentUrl(appOrigin, agentId, documentId, {
            workspaceSlug: activeWorkspaceSlug,
          });
          if (!url) return;
          await navigator.clipboard.writeText(url);
          toast.success(t('agentDocument.linkCopied', { ns: 'chat' }));
        },
      });
    }

    return items;
  }, [activeWorkspaceSlug, agentId, appOrigin, documentId, isReadonly, startEdit, t]);

  const titleFallback = t('agentDocument.portal.titlePlaceholder', { ns: 'chat' });

  if (!documentId) return null;

  if (isLoading || (!savedTitle && !editing)) {
    return (
      <Flexbox
        horizontal
        align={'center'}
        flex={1}
        gap={12}
        justify={'space-between'}
        width={'100%'}
      >
        <Flexbox flex={1}>
          <Skeleton height={16} width={180} />
        </Flexbox>
      </Flexbox>
    );
  }

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.root}
      flex={1}
      gap={6}
      justify={'space-between'}
      width={'100%'}
    >
      <Flexbox horizontal align={'center'} flex={1} gap={4} style={{ minWidth: 0 }}>
        <Text
          className={styles.crumb}
          color={cssVar.colorTextSecondary}
          onClick={onOpenDocumentsIndex}
        >
          {t('menu.allPages', { ns: 'file' })}
        </Text>
        <Icon className={styles.separator} icon={ChevronRight} size={14} />
        {editing ? (
          <input
            className={styles.titleInput}
            maxLength={TITLE_MAX_LENGTH}
            ref={inputRef}
            value={draft}
            onBlur={commitEdit}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value)}
            onKeyDown={handleTitleKeyDown}
          />
        ) : (
          <Text
            className={styles.title}
            ellipsis={{ tooltip: draft || titleFallback }}
            style={{ minWidth: 0 }}
            onClick={isReadonly ? undefined : startEdit}
          >
            {draft || titleFallback}
          </Text>
        )}
      </Flexbox>
      <Flexbox horizontal align={'center'} gap={8}>
        {!isReadonly && <AutoSaveHint />}
        {menuItems.length > 0 && (
          <DropdownMenu
            iconSpaceMode={'group'}
            items={menuItems}
            placement={'bottomRight'}
            popupProps={{ style: { minWidth: 200 } }}
          >
            <ActionIcon icon={MoreHorizontal} size={'small'} />
          </DropdownMenu>
        )}
      </Flexbox>
    </Flexbox>
  );
});

Header.displayName = 'PortalDocumentHeader';

export default Header;
