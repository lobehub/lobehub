'use client';

import { Flexbox } from '@lobehub/ui';
import type {AnchorProps} from 'antd';
import { startCase } from 'es-toolkit/compat';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToc } from '@/app/[variants]/(main)/community/(detail)/features/Toc/useToc';
import { useDetailContext } from '@/features/MCPPluginDetail/DetailProvider';
import { useQuery } from '@/hooks/useQuery';
import { McpNavKey } from '@/types/discover';

import Title from '../../../../../features/Title';
import Toc from '../../../../features/Toc';

const TocList = memo(() => {
  const { t } = useTranslation('discover');
  const { toc = [] } = useToc();
  const { activeTab = McpNavKey.Overview } = useQuery() as { activeTab: McpNavKey };
  const { deploymentOptions = [], tools = [], prompts = [] } = useDetailContext();

  const deployToc: AnchorProps['items'] = useMemo(
    () =>
      deploymentOptions?.map((item, index) => ({
        href: `#deployment-${index}`,
        key: `deployment-${index}`,
        level: 2,
        title: t('mcp.details.deployment.installation', {
          method: startCase(item.installationMethod),
        }),
      })),
    [deploymentOptions, t],
  );

  const schemaToc: AnchorProps['items'] = useMemo(() => {
    return [
      {
        href: `#tools`,
        key: `tools`,
        level: 2,
        title: t('mcp.details.schema.tools.title'),
      },
      ...tools.map((item) => ({
        href: `#tools-${item.name}`,
        key: `tools-${item.name}`,
        level: 3,
        title: item.name,
      })),
      {
        href: `#prompts`,
        key: `prompts`,
        level: 2,
        title: t('mcp.details.schema.prompts.title'),
      },
      ...prompts.map((item) => ({
        href: `#prompts-${item.name}`,
        key: `prompts-${item.name}`,
        level: 3,
        title: item.name,
      })),
      {
        href: `#resources`,
        key: `resources`,
        level: 2,
        title: t('mcp.details.schema.resources.title'),
      },
    ].filter(Boolean) as AnchorProps['items'];
  }, [tools, prompts, t]);

  const items: AnchorProps['items'] | undefined = useMemo(() => {
    switch (activeTab) {
      case McpNavKey.Overview: {
        return toc;
      }
      case McpNavKey.Deployment: {
        return deployToc;
      }
      case McpNavKey.Schema: {
        return schemaToc;
      }
      default: {
        return undefined;
      }
    }
  }, [activeTab, toc, deployToc, schemaToc]);

  if (!items || items.length === 0) return null;

  return (
    <Flexbox gap={16}>
      <Title>{t('mcp.details.sidebar.toc')}</Title>
      <Toc items={items} />
    </Flexbox>
  );
});

export default TocList;
