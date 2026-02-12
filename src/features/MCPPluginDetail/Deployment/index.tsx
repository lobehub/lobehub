import { SiApple, SiLinux } from '@icons-pack/react-simple-icons';
import { Microsoft } from '@lobehub/icons';
import {
  ActionIcon,
  Block,
  Collapse,
  Empty,
  Flexbox,
  Icon,
  Popover,
  Snippet,
  Tag,
} from '@lobehub/ui';
import { Divider, Steps } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { startCase } from 'es-toolkit/compat';
import {
  CheckIcon,
  CloudIcon,
  CodeIcon,
  DownloadIcon,
  MinusIcon,
  Package,
  TerminalIcon,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Descriptions from '@/components/Descriptions';
import InlineTable from '@/components/InlineTable';
import { markdownToTxt } from '@/utils/markdownToTxt';

import Title from '../../../app/[variants]/(main)/community/features/Title';
import InstallationIcon from '../../../components/MCPDepsIcon';
import CollapseDesc from '../CollapseDesc';
import CollapseLayout from '../CollapseLayout';
import { useDetailContext } from '../DetailProvider';
import Platform from './Platform';

const styles = createStaticStyles(({ css }) => {
  return {
    code: css`
      font-family: ${cssVar.fontFamilyCode};
    `,
  };
});

const Deployment = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { t } = useTranslation(['discover', 'plugin']);
  const { deploymentOptions = [], identifier } = useDetailContext();
  const [activeKey, setActiveKey] = useState<string[]>(['0']);

  if (!deploymentOptions)
    return (
      <Block variant="outlined">
        <Empty
          description={t('plugin:mcpEmpty.deployment')}
          descriptionProps={{ fontSize: 14 }}
          icon={Package}
          style={{ maxWidth: 400 }}
        />
      </Block>
    );

  const getConnectionTypeIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'stdio': {
        return <Icon icon={TerminalIcon} />;
      }
      default: {
        return <Icon icon={CloudIcon} />;
      }
    }
  };

  const getPlatformIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'macos': {
        return <SiApple color={cssVar.colorTextDescription} size={16} />;
      }
      case 'windows': {
        return <Microsoft color={cssVar.colorTextDescription} size={16} />;
      }
      case 'linux_debian': {
        return <SiLinux color={cssVar.colorTextDescription} size={16} />;
      }
      case 'manual': {
        return <CodeIcon color={cssVar.colorTextDescription} size={16} />;
      }
      default: {
        return <CodeIcon color={cssVar.colorTextDescription} size={16} />;
      }
    }
  };

  return (
    <Collapse
      activeKey={activeKey}
      expandIconPlacement={'end'}
      gap={24}
      variant={'outlined'}
      items={deploymentOptions.map((item, index) => {
        let properties: {
          description?: string;
          name: string;
          required?: boolean;
          type: string;
        }[] = [];
        if (item.connection?.configSchema?.properties) {
          properties = Object.entries(item.connection.configSchema.properties).map(
            ([key, value]: any) => {
              const required = item.connection.configSchema?.required?.includes(key);
              return {
                name: key,
                required,
                ...value,
              };
            },
          );
        }
        const setupSteps = item?.installationDetails?.setupSteps || [];
        const installCommand = [item.connection.command, item.connection.args?.join(' ')].join(' ');
        const showSystemDependencies =
          item?.systemDependencies && item.systemDependencies.length > 0;
        return {
          children: (
            <CollapseLayout
              items={[
                {
                  children: (
                    <Platform
                      connection={item.connection}
                      identifier={identifier}
                      mobile={mobile}
                    />
                  ),
                  key: 'platform',
                },
                {
                  children: (
                    <>
                      <p style={{ margin: 0 }}>{item.description}</p>
                      {setupSteps && setupSteps.length > 0 && (
                        <Steps
                          progressDot
                          current={-1}
                          direction="vertical"
                          size={'small'}
                          style={{ marginTop: 12 }}
                          items={setupSteps.map((i) => ({
                            title: <p style={{ color: cssVar.colorText }}>{i}</p>,
                          }))}
                        />
                      )}
                      {item.connection.command && (
                        <Snippet language={'shell'} prefix={'$'}>
                          {installCommand}
                        </Snippet>
                      )}
                    </>
                  ),
                  key: 'guide',
                  title: t('mcp.details.deployment.guide'),
                },
                item.connection.configSchema && {
                  children: (
                    <InlineTable
                      dataSource={properties}
                      pagination={false}
                      rowKey={'name'}
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
                          title: t('mcp.details.deployment.table.name'),
                        },
                        {
                          dataIndex: 'type',
                          render: (_, record) => <Tag className={styles.code}>{record.type}</Tag>,
                          title: t('mcp.details.deployment.table.type'),
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
                          title: t('mcp.details.deployment.table.required'),
                        },
                        {
                          dataIndex: 'description',
                          title: t('mcp.details.deployment.table.description'),
                        },
                      ]}
                    />
                  ),
                  key: 'env',
                  title: t('mcp.details.deployment.env'),
                },
                showSystemDependencies && {
                  children: (
                    <Descriptions
                      bordered
                      items={(item.systemDependencies || []).map((dep, i) => {
                        return {
                          icon: <InstallationIcon size={16} type={dep.name} />,
                          key: `system-dependency-${i}`,
                          label: dep.name,
                          value: (
                            <Flexbox horizontal align="center" gap={8}>
                              <span
                                style={{
                                  fontFamily: cssVar.fontFamilyCode,
                                  fontSize: 12,
                                }}
                              >
                                {dep.requiredVersion || 'installed'}
                              </span>
                              {dep.installInstructions && (
                                <Popover
                                  trigger="hover"
                                  content={
                                    <Flexbox gap={8}>
                                      <Descriptions
                                        rows={1}
                                        items={Object.entries(dep.installInstructions).map(
                                          ([system, code]) => ({
                                            copyable: true,
                                            icon: getPlatformIcon(system),
                                            key: system,
                                            label: (
                                              <span style={{ fontSize: 13, fontWeight: 500 }}>
                                                {system.toUpperCase()}
                                              </span>
                                            ),
                                            style: {
                                              fontFamily: cssVar.fontFamilyCode,
                                              fontSize: 12,
                                            },
                                            value: code,
                                          }),
                                        )}
                                      />
                                      {dep.checkCommand && (
                                        <>
                                          <Divider style={{ margin: 0 }} />
                                          <Descriptions
                                            rows={1}
                                            items={[
                                              {
                                                copyable: true,
                                                key: 'check',
                                                label: t('mcp.details.deployment.checkCommand'),
                                                style: {
                                                  fontFamily: cssVar.fontFamilyCode,
                                                  fontSize: 12,
                                                },
                                                value: dep.checkCommand,
                                              },
                                            ]}
                                          />
                                        </>
                                      )}
                                    </Flexbox>
                                  }
                                >
                                  <ActionIcon
                                    color={cssVar.colorTextDescription}
                                    icon={DownloadIcon}
                                    size={'small'}
                                  />
                                </Popover>
                              )}
                            </Flexbox>
                          ),
                        };
                      })}
                    />
                  ),
                  key: 'commandLine',
                  title: t('mcp.details.deployment.commandLine'),
                },
              ].filter(Boolean)}
            />
          ),
          desc: (
            <CollapseDesc hide={activeKey.includes(String(index))}>
              {item.description && markdownToTxt(item.description)}
            </CollapseDesc>
          ),
          key: String(index),
          label: (
            <Title
              icon={<InstallationIcon size={20} type={item.installationMethod} />}
              id={`deployment-${index}`}
              tag={
                <>
                  <Tag icon={getConnectionTypeIcon(item.connection.type)}>
                    {item.connection.type}
                  </Tag>
                  {item.isRecommended && (
                    <Tag color="success">{t('mcp.details.deployment.recommended')}</Tag>
                  )}
                </>
              }
            >
              {t('mcp.details.deployment.installation', {
                method: startCase(item.installationMethod),
              })}
            </Title>
          ),
        };
      })}
      onChange={setActiveKey}
    />
  );
});

export default Deployment;
