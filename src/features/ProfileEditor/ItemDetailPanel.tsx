'use client';

import { ActionIcon, cssVar, DraggablePanel, Flexbox, Tag, Text } from '@lobehub/ui';
import { XIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useItemDetailStore } from './itemDetailStore';

/** What the side panel shows about one tool, connector or skill. */
export interface ItemDetail {
  description?: string;
  icon: ReactNode;
  identifier: string;
  /** Where it comes from or what kind it is, as a short label. */
  tag: string;
  title: string;
  /** The tools it brings; empty for a skill, which is a set of steps rather than tools. */
  tools: { description?: string | null; name: string }[];
}

/**
 * The right-hand panel of the profile pages: opens when a tool, connector or skill row is
 * clicked, docked at the page edge, and says what the item is, where it comes from, and which
 * tools it gives the agent. The list stays visible beside it.
 */
const ItemDetailDock = memo(() => {
  const { t } = useTranslation('setting');
  const detail = useItemDetailStore((s) => s.detail);
  const close = useItemDetailStore((s) => s.close);

  return (
    <DraggablePanel
      showHandleWideArea
      backgroundColor={cssVar.colorBgContainer}
      defaultSize={{ width: 380 }}
      expand={!!detail}
      expandable={false}
      maxWidth={560}
      minWidth={320}
      placement={'right'}
      size={{ height: '100%' }}
      style={{ borderInlineStart: `1px solid ${cssVar.colorBorderSecondary}` }}
    >
      {detail ? (
        <Flexbox gap={20} height={'100%'} padding={24} style={{ overflowY: 'auto' }}>
          <Flexbox horizontal align={'center'} gap={12}>
            <Flexbox
              align={'center'}
              flex={'none'}
              justify={'center'}
              style={{
                background: cssVar.colorFillTertiary,
                borderRadius: 10,
                height: 40,
                width: 40,
              }}
            >
              {detail.icon}
            </Flexbox>
            <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
              <Text ellipsis style={{ fontSize: 16, fontWeight: 600 }}>
                {detail.title}
              </Text>
              <Flexbox horizontal>
                <Tag>{detail.tag}</Tag>
              </Flexbox>
            </Flexbox>
            <ActionIcon
              icon={XIcon}
              size={'small'}
              title={t('settingAgent.tools.close')}
              onClick={close}
            />
          </Flexbox>

          {detail.description ? <Text type={'secondary'}>{detail.description}</Text> : null}

          {detail.tools.length > 0 ? (
            <Flexbox gap={10}>
              <Text style={{ fontWeight: 500 }}>
                {t('settingAgent.tools.detail.tools', { count: detail.tools.length })}
              </Text>
              {detail.tools.map((tool) => (
                <Flexbox gap={2} key={tool.name}>
                  <Text code ellipsis fontSize={12}>
                    {tool.name}
                  </Text>
                  {tool.description ? (
                    <Text ellipsis={{ rows: 2 }} fontSize={12} type={'secondary'}>
                      {tool.description}
                    </Text>
                  ) : null}
                </Flexbox>
              ))}
            </Flexbox>
          ) : null}

          <Text code fontSize={12} type={'secondary'}>
            {detail.identifier}
          </Text>
        </Flexbox>
      ) : null}
    </DraggablePanel>
  );
});

ItemDetailDock.displayName = 'ItemDetailDock';

export default ItemDetailDock;
