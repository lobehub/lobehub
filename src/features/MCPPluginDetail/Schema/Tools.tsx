import { Flexbox, Highlighter, Icon, Markdown } from '@lobehub/ui';
import { Tag } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { CheckIcon, MinusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import InlineTable from '@/components/InlineTable';
import { markdownToTxt } from '@/utils/markdownToTxt';

import { useDetailContext } from '../DetailProvider';
import { SchemaEmpty, SchemaItem, SchemaList, SchemaSubtitle } from './SchemaList';
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

  if (!tools?.length) return <SchemaEmpty>{t('plugin:mcpEmpty.tools')}</SchemaEmpty>;

  return (
    <SchemaList activeKey={activeKey} setActiveKey={setActiveKey}>
      {tools.map((item) => {
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
        return (
          <SchemaItem
            desc={item.description ? markdownToTxt(item.description) : undefined}
            id={`tools-${item.name}`}
            key={item.name}
            meta={t('mcp.details.schema.tools.paramsCount', { count: properties.length })}
            name={item.name}
            open={activeKey.includes(item.name)}
          >
            {item.description && <Markdown fontSize={14}>{item.description}</Markdown>}
            <Flexbox gap={6}>
              <SchemaSubtitle>{t('mcp.details.schema.tools.inputSchema')}</SchemaSubtitle>
              {mode === ModeType.Docs ? (
                <InlineTable
                  dataSource={properties}
                  pagination={false}
                  rowKey={'name'}
                  columns={[
                    {
                      dataIndex: 'name',
                      render: (_, record) => (
                        <span className={styles.code} style={{ color: cssVar.gold }}>
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
                          icon={record.required ? CheckIcon : MinusIcon}
                          color={
                            record.required ? cssVar.colorSuccess : cssVar.colorTextDescription
                          }
                        />
                      ),
                      title: t('mcp.details.schema.tools.table.required'),
                    },
                    {
                      dataIndex: 'description',
                      title: t('mcp.details.schema.tools.table.description'),
                    },
                  ]}
                />
              ) : (
                <Highlighter language={'json'} style={{ fontSize: 12 }} variant={'borderless'}>
                  {JSON.stringify(item.inputSchema, null, 2)}
                </Highlighter>
              )}
            </Flexbox>
          </SchemaItem>
        );
      })}
    </SchemaList>
  );
});

export default Tools;
