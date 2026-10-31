'use client';

import { Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePortalDocumentTitleState } from './titleContext';

const styles = stylex.create({
  root: { minWidth: '0' },
  separator: { flexShrink: 0, color: cssVar.colorTextQuaternary },
  title: { fontSize: '13px', fontWeight: 600 },
  crumbButton: {
    cursor: 'pointer',
    flexShrink: 0,
    padding: '0',
    borderStyle: 'none',
    fontSize: '13px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    transition: `color ${cssVar.motionDurationFast} ${cssVar.motionEaseInOut}`,
    borderRadius: { 'default': null, ':focus-visible': cssVar.borderRadiusSM },
    outlineStyle: { 'default': null, ':focus-visible': 'none' },
    boxShadow: { 'default': null, ':focus-visible': `0 0 0 2px ${cssVar.colorPrimaryBorder}` },
  },
  crumbLabel: { flexShrink: 0, fontSize: '13px' },
});

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
    <Flexbox
      horizontal
      align={'center'}
      className={stylex.props(styles.root).className}
      flex={'0 1 auto'}
      gap={4}
    >
      {/* Navigable crumb gets a real button (keyboard reachable); a plain
            notebook document renders a noninteractive label with no affordance. */}
      {onOpenDocumentsIndex ? (
        <button
          {...stylex.props(styles.crumbButton)}
          type={'button'}
          onClick={onOpenDocumentsIndex}
        >
          {t('menu.allPages', { ns: 'file' })}
        </button>
      ) : (
        <Text
          className={stylex.props(styles.crumbLabel).className}
          color={cssVar.colorTextQuaternary}
        >
          {t('menu.allPages', { ns: 'file' })}
        </Text>
      )}
      <Icon className={stylex.props(styles.separator).className} icon={ChevronRight} size={14} />
      {/* Display only — renaming goes through the `…` menu's dialog. */}
      <Text
        className={stylex.props(styles.title).className}
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
