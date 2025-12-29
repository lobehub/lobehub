import { Block, Collapse, Empty, Highlighter, Icon, Markdown, Tag } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CheckIcon, MinusIcon, Wrench } from 'lucide-react';
import { markdownToTxt } from 'markdown-to-txt';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import InlineTable from '@/components/InlineTable';

import Title from '../../../app/[variants]/(main)/community/features/Title';
import CollapseDesc from '../CollapseDesc';
import CollapseLayout from '../CollapseLayout';
import { useDetailContext } from '../DetailProvider';
import { styles } from './style';
import { ModeType } from './types';

interface ToolsProps {
  activeKey?: string[];
  mode?: ModeType;
  setActiveKey?: (key: string[]) => void;
}

const Tools = memo<ToolsProps>(({ mode, activeKey = [], setActiveKey }) => {
  const { t } = useTranslation(['discover', 'plugin']);
  const { tools } = useDetailContext();

  if (!tools)
    return (
      <Block variant={'outlined'}>
        <Empty
          description={t('plugin:mcpEmpty.tools')}
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
      items={tools.map((item) => {
        let properties: {
          description?: string;
          name: string;
          required?: boolean;
          type: string;
        }[] = [];
        if (item.inputSchema?.properties) {
          properties = Object.entries(item.inputSchema.properties).map(([key, value]: any) => {
            const required = item.inputSchema?.required?.includes(key);
            return {
              name: key,
              required,
              ...value,
            };
          });
        }
        return {
          children: (
            <CollapseLayout
              items={[
                {
                  children: <Markdown>{item.description || ''}</Markdown>,
                  key: 'instructions',
                  title: t('mcp.details.schema.tools.instructions'),
                },
                {
                  children:
                    mode === ModeType.Docs ? (
                      <InlineTable
                        columns={[
                          {
                            dataIndex: 'name',
                            render: (_, record) => (
                              <span
                                className={styles.code}
                                style={{
                                  color: cssVar.gold,
                                }}
                              >
                                {record.name}
                              </span>
                            ),
                            title: t('mcp.details.schema.tools.table.name'),
                          },
                          {
                            dataIndex: 'type',
                            render: (_, record) => <Tag className={styles.code}>{record.type}</Tag>,
                            title: t('mcp.details.schema.tools.table.type'),
                          },
                          {
                            dataIndex: 'required',
                            render: (_, record) => (
                              <Icon
                                color={
                                  record.required
                                    ? cssVar.colorSuccess
                                    : cssVar.colorTextDescription
                                }
                                icon={record.required ? CheckIcon : MinusIcon}
                              />
                            ),
                            title: t('mcp.details.schema.tools.table.required'),
                          },
                          {
                            dataIndex: 'description',
                            title: t('mcp.details.schema.tools.table.description'),
                          },
                        ]}
                        dataSource={properties}
                        pagination={false}
                        rowKey={'name'}
                      />
                    ) : (
                      <Highlighter
                        language={'json'}
                        style={{ fontSize: 12 }}
                        variant={'borderless'}
                      >
                        {JSON.stringify(item.inputSchema, null, 2)}
                      </Highlighter>
                    ),
                  key: 'inputSchema',
                  title: t('mcp.details.schema.tools.inputSchema'),
                },
              ]}
            />
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
