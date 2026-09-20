'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, type DropdownItem, DropdownMenu, Skeleton, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRight, MoreHorizontal, Pencil } from 'lucide-react';
import { type ChangeEvent, memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import AutoSaveHint from './AutoSaveHint';
import CopyLinkMenuItem from './CopyLinkMenuItem';
import { TITLE_MAX_LENGTH, usePortalDocumentTitle } from './usePortalDocumentHeader';

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
  const {
    commitEdit,
    draft,
    editing,
    isLoading,
    metaLocked,
    savedTitle,
    setDraft,
    startEdit,
    syncIdleDraft,
    titleFallback,
  } = usePortalDocumentTitle();

  const inputRef = useRef<HTMLInputElement>(null);

  // Follow the SWR source while idle; never clobber a draft mid-typing.
  useEffect(() => {
    syncIdleDraft(editing);
  }, [editing, syncIdleDraft]);

  const beginEdit = useCallback(() => {
    startEdit();
    // The input mounts during this render; focus once it exists.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [startEdit]);

  const handleTitleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        // blur commits; Escape restores first so the blur writes nothing new.
        event.preventDefault();
        inputRef.current?.blur();
      } else if (event.key === 'Escape') {
        setDraft(savedTitle);
      }
    },
    [savedTitle, setDraft],
  );

  const menuItems = useMemo<DropdownItem[]>(() => {
    const items: DropdownItem[] = [];

    if (!metaLocked) {
      items.push({
        icon: <Icon icon={Pencil} />,
        key: 'rename',
        label: t('rename', { ns: 'common' }),
        onClick: beginEdit,
      });
    }

    return items;
  }, [beginEdit, metaLocked, t]);

  if (isLoading) {
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
            onClick={metaLocked ? undefined : beginEdit}
          >
            {draft || titleFallback}
          </Text>
        )}
      </Flexbox>
      <Flexbox horizontal align={'center'} gap={8}>
        {!metaLocked && <AutoSaveHint />}
        <CopyLinkMenuItem />
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
