'use client';

import { listBuiltinRenderEntries } from '@lobechat/builtin-tools/renders';
import type { BuiltinRender } from '@lobechat/types';
import { Block, Flexbox, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Component, type ReactNode, useEffect, useMemo } from 'react';

import { useAgentGroupStore } from '@/store/agentGroup';

import {
  DEVTOOLS_GROUP_DETAIL,
  DEVTOOLS_GROUP_ID,
  getToolRenderFixture,
  getToolRenderMeta,
} from './toolRenderFixtures';

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    gap: 24px;
    max-width: 1400px;
    padding: 28px;
  `,
  card: css`
    overflow: hidden;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 20px;

    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  cardBody: css`
    padding: 16px;
  `,
  cardHeader: css`
    gap: 10px;
    padding: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    background: linear-gradient(
      180deg,
      ${cssVar.colorFillQuaternary} 0%,
      ${cssVar.colorBgContainer} 100%
    );
  `,
  code: css`
    overflow: auto;

    max-height: 280px;
    margin: 0;
    padding: 12px;
    border-radius: 12px;

    font-size: 12px;
    line-height: 1.55;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
  fixtureSummary: css`
    cursor: pointer;
    user-select: none;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  group: css`
    gap: 16px;
  `,
  groupHeader: css`
    gap: 8px;
    padding-block-end: 4px;
  `,
  page: css`
    overflow: auto;
    width: 100%;
    height: 100%;
    background:
      radial-gradient(circle at top, ${cssVar.colorFillTertiary} 0%, transparent 35%),
      ${cssVar.colorBgLayout};
  `,
  previewShell: css`
    padding: 16px;
    border-radius: 16px;
    background: ${cssVar.colorFillQuaternary};
  `,
  subtitle: css`
    max-width: 900px;
    font-size: 14px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,
  title: css`
    font-size: 36px;
    font-weight: 700;
    line-height: 1.1;
    color: ${cssVar.colorText};
  `,
}));

class RenderBoundary extends Component<{ children: ReactNode }, { error?: Error | undefined }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: undefined };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    if (!this.state.error) return this.props.children;

    return (
      <Block padding={16} variant={'outlined'}>
        <Flexbox gap={8}>
          <Text fontSize={14} type={'danger'} weight={500}>
            Render crashed
          </Text>
          <Text fontSize={12} type={'secondary'}>
            {this.state.error.message}
          </Text>
        </Flexbox>
      </Block>
    );
  }
}

const DevtoolsPage = () => {
  useEffect(() => {
    const previousGroupState = useAgentGroupStore.getState();

    useAgentGroupStore.setState({
      activeGroupId: DEVTOOLS_GROUP_ID,
      groupMap: {
        ...previousGroupState.groupMap,
        [DEVTOOLS_GROUP_ID]: DEVTOOLS_GROUP_DETAIL as any,
      },
    });

    return () => {
      useAgentGroupStore.setState({
        activeGroupId: previousGroupState.activeGroupId,
        groupMap: previousGroupState.groupMap,
      });
    };
  }, []);

  const groupedEntries = useMemo(() => {
    const sections = new Map<
      string,
      {
        description?: string;
        entries: Array<{
          apiName: string;
          description?: string;
          fixture: ReturnType<typeof getToolRenderFixture>;
          identifier: string;
          render: BuiltinRender;
          toolsetName: string;
        }>;
        toolsetName: string;
      }
    >();

    const entries = listBuiltinRenderEntries().sort((left, right) => {
      const identifierCompare = left.identifier.localeCompare(right.identifier);
      if (identifierCompare !== 0) return identifierCompare;
      return left.apiName.localeCompare(right.apiName);
    });

    for (const entry of entries) {
      const meta = getToolRenderMeta(entry.identifier, entry.apiName);
      const fixture = getToolRenderFixture(entry.identifier, entry.apiName, meta.api);
      const group = sections.get(entry.identifier);

      const normalizedEntry = {
        apiName: entry.apiName,
        description: meta.description,
        fixture,
        identifier: entry.identifier,
        render: entry.render,
        toolsetName: meta.toolsetName,
      };

      if (group) {
        group.entries.push(normalizedEntry);
      } else {
        sections.set(entry.identifier, {
          description: meta.toolsetDescription,
          entries: [normalizedEntry],
          toolsetName: meta.toolsetName,
        });
      }
    }

    return [...sections.values()];
  }, []);

  return (
    <div className={styles.page}>
      <Flexbox className={styles.body}>
        <Flexbox gap={12}>
          <div className={styles.title}>Devtools Render Gallery</div>
          <div className={styles.subtitle}>
            Development-only preview page for every registered builtin tool render. Each card is
            driven by a stable local fixture so we can visually smoke test new tool UIs without
            reproducing a full conversation flow first.
          </div>
        </Flexbox>

        {groupedEntries.map((group) => (
          <Flexbox className={styles.group} key={group.toolsetName}>
            <Flexbox className={styles.groupHeader}>
              <Flexbox horizontal align={'center'} gap={8}>
                <Text fontSize={20} weight={600}>
                  {group.toolsetName}
                </Text>
                <Tag>{group.entries.length} renders</Tag>
              </Flexbox>
              {group.description && (
                <Text fontSize={13} type={'secondary'}>
                  {group.description}
                </Text>
              )}
            </Flexbox>

            {group.entries.map((entry) => {
              const Render = entry.render as BuiltinRender;
              const fixture = entry.fixture;
              const messageId = `devtools-${entry.identifier}-${entry.apiName}`;

              return (
                <Flexbox className={styles.card} key={`${entry.identifier}-${entry.apiName}`}>
                  <Flexbox className={styles.cardHeader}>
                    <Flexbox horizontal align={'center'} gap={8}>
                      <Text fontSize={16} weight={600}>
                        {entry.apiName}
                      </Text>
                      <Tag>{entry.identifier}</Tag>
                    </Flexbox>
                    {entry.description && (
                      <Text fontSize={13} type={'secondary'}>
                        {entry.description}
                      </Text>
                    )}
                  </Flexbox>

                  <Flexbox className={styles.cardBody} gap={12}>
                    <div className={styles.previewShell}>
                      <RenderBoundary>
                        <Render
                          apiName={entry.apiName}
                          args={fixture.args}
                          content={fixture.content}
                          identifier={entry.identifier}
                          messageId={messageId}
                          pluginError={fixture.pluginError}
                          pluginState={fixture.pluginState}
                          toolCallId={`${messageId}-tool`}
                        />
                      </RenderBoundary>
                    </div>

                    <details>
                      <summary className={styles.fixtureSummary}>Fixture payload</summary>
                      <pre className={styles.code}>
                        {JSON.stringify(
                          {
                            args: fixture.args,
                            content: fixture.content,
                            pluginError: fixture.pluginError,
                            pluginState: fixture.pluginState,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  </Flexbox>
                </Flexbox>
              );
            })}
          </Flexbox>
        ))}
      </Flexbox>
    </div>
  );
};

export default DevtoolsPage;
