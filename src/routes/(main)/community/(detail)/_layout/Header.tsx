'use client';

import { ActionIcon, cssVar, Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ArrowLeft } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import urlJoin from 'url-join';

import { MARKETPLACE_MCP_PATH, MARKETPLACE_SEGMENT } from '@/features/Marketplace/paths';
import NavHeader from '@/features/NavHeader';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { styles } from './Header/style';

const Header = memo(() => {
  const { t } = useTranslation('common');
  const location = useLocation();
  const navigate = useWorkspaceAwareNavigate();
  const path = location.pathname.split('/').filter(Boolean);
  const communityIndex = path.indexOf(MARKETPLACE_SEGMENT);
  const detailType = communityIndex >= 0 ? path[communityIndex + 1] : undefined;

  // A detail page's bar only goes back: no store search or account entry.
  const handleGoBack = () => {
    const catalog = location.state?.marketplaceCatalog;
    if (typeof catalog === 'string') {
      navigate(catalog, { escape: true, replace: true });
      return;
    }
    if (detailType === 'mcp') {
      navigate(MARKETPLACE_MCP_PATH);
      return;
    }
    // group_agent goes back to agent list page
    if (detailType === 'group_agent') {
      navigate('/marketplace/agent');
      return;
    }

    // Types that have their own list pages
    const typesWithListPage = ['agent', 'model', 'provider', 'mcp', 'skill'];

    if (detailType && typesWithListPage.includes(detailType)) {
      navigate(urlJoin('/marketplace', detailType));
    } else {
      // For user or any other type without a list page
      navigate('/marketplace');
    }
  };

  const cssVariables: Record<string, string> = {
    '--header-border-color': cssVar.colorBorderSecondary,
  };

  return (
    <NavHeader
      className={stylex.props(styles.headerContainer).className}
      style={cssVariables}
      left={
        <Flexbox horizontal align={'center'} flex={1} gap={8}>
          <ActionIcon icon={ArrowLeft} size={'small'} title={t('back')} onClick={handleGoBack} />
        </Flexbox>
      }
      styles={{
        left: { flex: 1 },
      }}
    />
  );
});

export default Header;
