'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Skeleton, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePortalDocumentTitleState } from './titleContext';

const styles = createStaticStyles(({ css }) => ({
  root: css`
    min-width: 0;
  `,
  separator: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextQuaternary};
  `,
  title: css`
    font-size: 13px;
    font-weight: 600;
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
  const { isLoading, savedTitle, titleFallback } = usePortalDocumentTitleState();

  if (isLoading) {
    return <Skeleton height={16} width={180} />;
  }

  return (
    // Hug the title so the shared `…` rides right behind it.
    <Flexbox horizontal align={'center'} className={styles.root} flex={'0 1 auto'} gap={4}>
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
      {/* Display only — renaming goes through the `…` menu's dialog. */}
      <Text
        className={styles.title}
        ellipsis={{ tooltip: savedTitle || titleFallback }}
        style={{ minWidth: 0 }}
      >
        {savedTitle || titleFallback}
      </Text>
    </Flexbox>
  );
});

Header.displayName = 'PortalDocumentHeader';

export default Header;
