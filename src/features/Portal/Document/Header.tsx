'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Skeleton, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRight } from 'lucide-react';
import { type ChangeEvent, memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { usePortalDocumentTitleState } from './titleContext';
import { TITLE_MAX_LENGTH } from './usePortalDocumentHeader';

const styles = createStaticStyles(({ css }) => ({
  root: css`
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

    /* Keep a token-based focus ring for keyboard users; the native outline
       is suppressed only in favor of this replacement. */
    outline: none;

    &:focus-visible {
      border-radius: ${cssVar.borderRadiusSM};
      box-shadow: 0 0 0 2px ${cssVar.colorPrimaryBorder};
    }
  `,
  crumbButton: css`
    cursor: pointer;

    flex-shrink: 0;

    padding: 0;
    border: none;

    font-size: 13px;
    color: ${cssVar.colorTextSecondary};

    background: none;

    transition: color ${cssVar.motionDurationFast} ${cssVar.motionEaseInOut};

    &:hover {
      color: ${cssVar.colorText};
    }

    &:focus-visible {
      border-radius: ${cssVar.borderRadiusSM};
      outline: none;
      box-shadow: 0 0 0 2px ${cssVar.colorPrimaryBorder};
    }
  `,
  crumbLabel: css`
    flex-shrink: 0;
    font-size: 13px;
  `,
}));

interface HeaderProps {
  /** Navigate to the documents index on breadcrumb click (agent route has one). */
  onOpenDocumentsIndex?: () => void;
}

const Header = memo<HeaderProps>(({ onOpenDocumentsIndex }) => {
  const { t } = useTranslation('file');
  const {
    cancelEdit,
    commitEdit,
    draft,
    editing,
    isLoading,
    metaLocked,
    setDraft,
    startEdit,
    syncIdleDraft,
    titleFallback,
  } = usePortalDocumentTitleState();

  const inputRef = useRef<HTMLInputElement>(null);

  // Follow the SWR source while idle; never clobber a draft mid-typing.
  useEffect(() => {
    syncIdleDraft(editing);
  }, [editing, syncIdleDraft]);

  // Rename from the header's `…` menu flips the same shared edit state, so
  // focus follows the flag rather than the click that started it.
  useEffect(() => {
    if (!editing) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [editing]);

  const handleTitleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        // blur commits; Escape restores first so the blur writes nothing new.
        event.preventDefault();
        inputRef.current?.blur();
      } else if (event.key === 'Escape') {
        // Cancel BEFORE blurring: blur fires `commitEdit` synchronously with
        // the still-edited draft, so the cancel flag is what turns that commit
        // into a no-op instead of persisting the cancelled title.
        event.preventDefault();
        cancelEdit();
        inputRef.current?.blur();
      }
    },
    [cancelEdit],
  );

  if (isLoading) {
    return <Skeleton height={16} width={180} />;
  }

  return (
    // Hug the title so the shared `…` rides right behind it; only an open
    // editor claims the free width to type into.
    <Flexbox
      horizontal
      align={'center'}
      className={styles.root}
      flex={editing ? 1 : '0 1 auto'}
      gap={4}
    >
      {/* Navigable crumb gets a real button (keyboard reachable); a plain
            notebook document renders a noninteractive label with no affordance. */}
      {onOpenDocumentsIndex ? (
        <button className={styles.crumbButton} type={'button'} onClick={onOpenDocumentsIndex}>
          {t('menu.allPages', { ns: 'file' })}
        </button>
      ) : (
        <Text className={styles.crumbLabel} color={cssVar.colorTextQuaternary}>
          {t('menu.allPages', { ns: 'file' })}
        </Text>
      )}
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
          onClick={metaLocked ? undefined : startEdit}
        >
          {draft || titleFallback}
        </Text>
      )}
    </Flexbox>
  );
});

Header.displayName = 'PortalDocumentHeader';

export default Header;
