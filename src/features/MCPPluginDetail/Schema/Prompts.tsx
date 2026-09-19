import { Flexbox, Highlighter, Icon, Markdown } from '@lobehub/ui';
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

interface PromptsProps {
  activeKey?: string[];
  mode?: ModeType;
  setActiveKey?: (key: string[]) => void;
}

const Prompts = memo<PromptsProps>(({ mode, activeKey = [], setActiveKey }) => {
  const { t } = useTranslation(['discover', 'plugin']);
  const { prompts } = useDetailContext();

  if (!prompts?.length) return <SchemaEmpty>{t('plugin:mcpEmpty.prompts')}</SchemaEmpty>;

  return (
    <SchemaList activeKey={activeKey} setActiveKey={setActiveKey}>
      {prompts.map((item) => (
        <SchemaItem
          desc={item.description ? markdownToTxt(item.description) : undefined}
          id={`prompts-${item.name}`}
          key={item.name}
          meta={t('mcp.details.schema.prompts.argsCount', { count: item.arguments?.length ?? 0 })}
          name={item.name}
          open={activeKey.includes(item.name)}
        >
          {item.description && <Markdown fontSize={14}>{item.description}</Markdown>}
          <Flexbox gap={6}>
            <SchemaSubtitle>{t('mcp.details.schema.prompts.arguments')}</SchemaSubtitle>
            {mode === ModeType.Docs ? (
              <InlineTable
                dataSource={item.arguments}
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
                    title: t('mcp.details.schema.prompts.table.name'),
                  },
                  {
                    dataIndex: 'required',
                    render: (_, record) => (
                      <Icon
                        color={record.required ? cssVar.colorSuccess : cssVar.colorTextDescription}
                        icon={record.required ? CheckIcon : MinusIcon}
                      />
                    ),
                    title: t('mcp.details.schema.prompts.table.required'),
                  },
                  {
                    dataIndex: 'description',
                    title: t('mcp.details.schema.prompts.table.description'),
                  },
                ]}
              />
            ) : (
              <Highlighter language={'json'} style={{ fontSize: 12 }} variant={'borderless'}>
                {JSON.stringify(item.arguments, null, 2)}
              </Highlighter>
            )}
          </Flexbox>
        </SchemaItem>
      ))}
    </SchemaList>
  );
});

export default Prompts;
