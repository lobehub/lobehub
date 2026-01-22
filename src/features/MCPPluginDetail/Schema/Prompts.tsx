import { Block, Collapse, Empty, Highlighter, Icon, Markdown } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CheckIcon, MessageSquare, MinusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import InlineTable from '@/components/InlineTable';
import { markdownToTxt } from '@/utils/markdownToTxt';

import Title from '../../../app/[variants]/(main)/community/features/Title';
import CollapseDesc from '../CollapseDesc';
import CollapseLayout from '../CollapseLayout';
import { useDetailContext } from '../DetailProvider';
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

  if (!prompts)
    return (
      <Block variant={'outlined'}>
        <Empty
          description={t('plugin:mcpEmpty.prompts')}
          descriptionProps={{ fontSize: 14 }}
          icon={MessageSquare}
          style={{ maxWidth: 400 }}
        />
      </Block>
    );

  return (
    <Collapse
      activeKey={activeKey}
      expandIconPlacement={'end'}
      gap={8}
      items={prompts.map((item) => {
        return {
          children: (
            <CollapseLayout
              items={[
                {
                  children: <Markdown>{item.description || ''}</Markdown>,
                  key: 'instructions',
                  title: t('mcp.details.schema.prompts.instructions'),
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
                            title: t('mcp.details.schema.prompts.table.name'),
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
                            title: t('mcp.details.schema.prompts.table.required'),
                          },
                          {
                            dataIndex: 'description',
                            title: t('mcp.details.schema.prompts.table.description'),
                          },
                        ]}
                        dataSource={item.arguments}
                        pagination={false}
                        rowKey={'name'}
                      />
                    ) : (
                      <Highlighter
                        language={'json'}
                        style={{ fontSize: 12 }}
                        variant={'borderless'}
                      >
                        {JSON.stringify(item.arguments, null, 2)}
                      </Highlighter>
                    ),
                  key: 'arguments',
                  title: t('mcp.details.schema.prompts.arguments'),
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
            <Title id={`prompts-${item.name}`} level={3}>
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

export default Prompts;
