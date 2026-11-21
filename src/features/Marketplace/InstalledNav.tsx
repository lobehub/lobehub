'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SectionTitle, { useSectionTriggerStyle } from '@/features/NavPanel/components/SectionTitle';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useActiveLocation } from '@/hooks/useActiveLocation';

import ConnectedAppNav from './Apps/ConnectedAppNav';
import { getMarketplaceSubPath, MARKETPLACE_CONNECTED_APPS_PATH } from './paths';

const styles = stylex.create({
  collectionLink: {
    backgroundColor: {
      'default': 'transparent',
      ':hover': cssVar.colorFillTertiary,
      ':focus-visible': cssVar.colorFillTertiary,
    },
    borderRadius: cssVar.borderRadiusSM,
    display: 'flex',
  },
});

const InstalledNav = memo(() => {
  const { t } = useTranslation('discover');
  const { pathname, search } = useActiveLocation();
  const searchParams = new URLSearchParams(search);
  const sectionTriggerStyle = useSectionTriggerStyle();

  const subPath = getMarketplaceSubPath(pathname);
  return (
    <Flexbox gap={2} paddingBlock={8} paddingInline={4}>
      <WorkspaceLink
        className={stylex.props(styles.collectionLink).className}
        style={sectionTriggerStyle}
        to={MARKETPLACE_CONNECTED_APPS_PATH}
        aria-current={
          subPath === 'app' && searchParams.get('view') === 'connected' ? 'page' : undefined
        }
      >
        <SectionTitle>{t('apps.connected')}</SectionTitle>
      </WorkspaceLink>
      <ConnectedAppNav selected={subPath?.startsWith('app/') ? subPath.slice(4) : undefined} />
    </Flexbox>
  );
});

InstalledNav.displayName = 'MarketplaceInstalledNav';

export default InstalledNav;
