import { Block, Collapse, Empty, Highlighter, Markdown, Tag } from '@lobehub/ui';
import { isString } from 'es-toolkit/compat';
import { Wrench } from 'lucide-react';
import { markdownToTxt } from 'markdown-to-txt';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import InlineTable from '@/components/InlineTable';
import CollapseDesc from '@/features/MCPPluginDetail/CollapseDesc';
import CollapseLayout from '@/features/MCPPluginDetail/CollapseLayout';
import { ModeType } from '@/features/MCPPluginDetail/Schema/types';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';

import Title from '../../../../../app/[variants]/(main)/community/features/Title';

interface ToolProps {
  mode?: ModeType;
}

const Tools = memo<ToolProps>(({ mode }) => {
  const { t } = useTranslation('discover');
  const [activeKey, setActiveKey] = useState<string[]>([]);
  const [identifier] = useToolStore((s) => [s.activePluginIdentifier]);
  const plugin = useToolStore(pluginSelectors.getInstalledPluginById(identifier));
  const { manifest } = plugin || {};

  if (!manifest || isString(manifest))
    return (
      <Block variant={'outlined'}>
        <Empty
          description={t('mcp.details.schema.tools.empty')}
          descriptionProps={{ fontSize: 14 }}
          icon={Wrench}
          style={{ maxWidth: 400 }}
        />
      </Block>
    );

  return (
    <Collapse
      activeKey={activeKey}
      expandIconPlacement={'end'}
      gap={8}
      items={manifest.api.map((item) => {
        const parameters = Object.entries(item.parameters?.properties || {}).map(
          ([key, value]) => ({
            name: key,
            type: value.type,
          }),
        );
        return {
          children:
            mode === ModeType.Docs ? (
              <CollapseLayout
                items={[
                  {
                    children: <Markdown>{item.description || ''}</Markdown>,
                    key: 'instructions',
                    title: t('mcp.details.schema.tools.instructions'),
                  },
                  {
                    children: (
                      <InlineTable
                        columns={[
                          {
                            dataIndex: 'name',
                            render: (name: string) => <code>{name}</code>,
                            title: t('plugins.meta.parameter'),
                          },
                          {
                            dataIndex: 'type',
                            render: (type: string) => <Tag>{type.toUpperCase()}</Tag>,
                            title: t('plugins.meta.type'),
                          },
                        ]}
                        dataSource={parameters}
                        pagination={false}
                        rowKey={'name'}
                      />
                    ),
                    key: 'inputSchema',
                    title: t('mcp.details.schema.tools.inputSchema'),
                  },
                ]}
              />
            ) : (
              <Highlighter language={'json'} style={{ fontSize: 12 }} variant={'borderless'}>
                {JSON.stringify(item, null, 2)}
              </Highlighter>
            ),
          desc: item.description && (
            <CollapseDesc hide={activeKey.includes(item.name)}>
              {markdownToTxt(item.description)}
            </CollapseDesc>
          ),
          key: item.name,
          label: (
            <Title id={`tools-${item.name}`} level={3}>
              {item.name}
            </Title>
          ),
        };
      })}
      onChange={setActiveKey}
      variant={'outlined'}
    />
  );
});

export default Tools;
