'use client';

import { SOCIAL_URL } from '@lobechat/business-const';
import { Flexbox, Icon } from '@lobehub/ui';
import { Tabs, type TabsItem, Tag } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  BookOpenIcon,
  BotIcon,
  CodeIcon,
  DownloadIcon,
  HistoryIcon,
  ListIcon,
  PackageCheckIcon,
  SettingsIcon,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';
import { McpNavKey } from '@/types/discover';

import { useDetailContext } from './DetailProvider';

const styles = stylex.create({
  link: { color: { 'default': cssVar.colorTextDescription, ':hover': cssVar.colorInfo } },
  nav: {
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorder,
  },
  tabs: {
    'scrollbarWidth': 'none',
    'overflowX': 'auto',
    'flex': '1',
    'minWidth': '0',
    '::-webkit-scrollbar': { display: 'none' },
  },
});

interface NavProps {
  activeTab?: McpNavKey;
  inModal?: boolean;
  mobile?: boolean;
  noSettings?: boolean;
  setActiveTab?: (tab: McpNavKey) => void;
}
const Nav = memo<NavProps>(
  ({ mobile, noSettings, setActiveTab, activeTab = McpNavKey.Overview, inModal }) => {
    const { t } = useTranslation('discover');
    const {
      versions,
      deploymentOptions,
      toolsCount,
      resourcesCount,
      promptsCount,
      github,
      identifier,
    } = useDetailContext();

    // Check if the plugin is installed
    const installedPlugin = useToolStore(pluginSelectors.getInstalledPluginById(identifier));

    const deploymentCount = deploymentOptions?.length || 0;
    const schemaCount = Number(toolsCount) + Number(promptsCount) + Number(resourcesCount);
    const versionCount = versions?.length || 0;

    const nav = (
      <Tabs
        activeKey={activeTab}
        className={stylex.props(styles.tabs).className}
        variant="square"
        items={
          [
            // Only show the settings tab for installed plugins
            !noSettings &&
              installedPlugin && {
                icon: <Icon icon={SettingsIcon} size={16} />,
                key: McpNavKey.Settings,
                label: t('mcp.details.settings.title'),
              },
            {
              icon: <Icon icon={BookOpenIcon} size={16} />,
              key: McpNavKey.Overview,
              label: t('mcp.details.overview.title'),
            },
            {
              icon: <Icon icon={DownloadIcon} size={16} />,
              key: McpNavKey.Deployment,
              label:
                deploymentCount > 1 ? (
                  <Flexbox
                    horizontal
                    align={'center'}
                    gap={6}
                    style={{
                      display: 'inline-flex',
                    }}
                  >
                    {t('mcp.details.deployment.title')}
                    <Tag>{deploymentCount}</Tag>
                  </Flexbox>
                ) : (
                  t('mcp.details.deployment.title')
                ),
            },
            {
              icon: <Icon icon={CodeIcon} size={16} />,
              key: McpNavKey.Schema,
              label:
                schemaCount > 1 ? (
                  <Flexbox
                    horizontal
                    align={'center'}
                    gap={6}
                    style={{
                      display: 'inline-flex',
                    }}
                  >
                    {t('mcp.details.schema.title')}
                    <Tag>{schemaCount}</Tag>
                  </Flexbox>
                ) : (
                  t('mcp.details.schema.title')
                ),
            },
            !inModal && {
              icon: <Icon icon={ListIcon} size={16} />,
              key: McpNavKey.Related,
              label: t('mcp.details.related.title'),
            },
            {
              icon: <Icon icon={PackageCheckIcon} size={16} />,
              key: McpNavKey.Score,
              label: t('mcp.details.score.title'),
            },
            {
              icon: <Icon icon={BotIcon} size={16} />,
              key: McpNavKey.Agents,
              label: t('mcp.details.agents.title'),
            },
            !inModal && {
              icon: <Icon icon={HistoryIcon} size={16} />,
              key: McpNavKey.Version,
              label:
                versionCount > 1 ? (
                  <Flexbox
                    horizontal
                    align={'center'}
                    gap={6}
                    style={{
                      display: 'inline-flex',
                    }}
                  >
                    {t('mcp.details.versions.title')}
                    <Tag>{versionCount}</Tag>
                  </Flexbox>
                ) : (
                  t('mcp.details.versions.title')
                ),
            },
          ].filter(Boolean) as TabsItem[]
        }
        onChange={(key) => setActiveTab?.(key as McpNavKey)}
      />
    );

    return mobile ? (
      nav
    ) : (
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.nav).className}
        justify={'space-between'}
      >
        {nav}
        {!inModal && (
          <Flexbox
            horizontal
            flex="none"
            gap={12}
            style={{ marginInlineStart: 12, whiteSpace: 'nowrap' }}
          >
            <a
              {...stylex.props(styles.link)}
              href={SOCIAL_URL.discord}
              rel="noreferrer"
              target="_blank"
            >
              {t('mcp.details.nav.needHelp')}
            </a>
            {github?.url && (
              <>
                <a
                  {...stylex.props(styles.link)}
                  href={github.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {t('mcp.details.nav.viewSourceCode')}
                </a>
                <a
                  {...stylex.props(styles.link)}
                  href={urlJoin(github.url, 'issues')}
                  rel="noreferrer"
                  target="_blank"
                >
                  {t('mcp.details.nav.reportIssue')}
                </a>
              </>
            )}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

export default Nav;
