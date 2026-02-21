'use client';

import { SOCIAL_URL } from '@lobechat/business-const';
import { type TabsProps } from '@lobehub/ui';
import { Flexbox, Icon, Tabs, Tag } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
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

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    link: css`
      color: ${cssVar.colorTextDescription};

      &:hover {
        color: ${cssVar.colorInfo};
      }
    `,
    nav: css`
      border-block-end: 1px solid ${cssVar.colorBorder};
    `,
    tabs: css`
      scrollbar-width: none;
      overflow-x: auto;
      flex: 1;
      min-width: 0;

      &::-webkit-scrollbar {
        display: none;
      }
    `,
  };
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

    // 检查插件是否已安装
    const installedPlugin = useToolStore(pluginSelectors.getInstalledPluginById(identifier));

    const deploymentCount = deploymentOptions?.length || 0;
    const schemaCount = Number(toolsCount) + Number(promptsCount) + Number(resourcesCount);
    const versionCount = versions?.length || 0;

    const nav = (
      <Tabs
        activeKey={activeTab}
        className={styles.tabs}
        compact={mobile}
        items={
          [
            // 只有已安装的插件才显示设置 tab
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
          ].filter(Boolean) as TabsProps['items']
        }
        onChange={(key) => setActiveTab?.(key as McpNavKey)}
      />
    );

    return mobile ? (
      nav
    ) : (
      <Flexbox horizontal align={'center'} className={styles.nav} justify={'space-between'}>
        {nav}
        {!inModal && (
          <Flexbox horizontal gap={12}>
            <a className={styles.link} href={SOCIAL_URL.discord} rel="noreferrer" target="_blank">
              {t('mcp.details.nav.needHelp')}
            </a>
            {github?.url && (
              <>
                <a className={styles.link} href={github.url} rel="noreferrer" target="_blank">
                  {t('mcp.details.nav.viewSourceCode')}
                </a>
                <a
                  className={styles.link}
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
