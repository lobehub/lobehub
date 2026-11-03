'use client';

import { type UISignalCallbacksBlock } from '@lobechat/types';
import { Accordion, Block, Flexbox, Icon, Markdown, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Radio } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  callbackBody: { overflow: 'auto', maxHeight: '360px' },
  callbackItem: {
    paddingBlock: '4px',
    borderBlockEndWidth: { 'default': null, ':not(:last-child)': '1px' },
    borderBlockEndStyle: { 'default': null, ':not(:last-child)': 'solid' },
    borderBlockEndColor: { 'default': null, ':not(:last-child)': cssVar.colorBorderSecondary },
  },
  sequence: {
    flex: 'none',
    minWidth: '20px',
    fontSize: '11px',
    fontFeatureSettings: "'tnum'",
    color: cssVar.colorTextTertiary,
  },
});

const SignalCallbacks = memo<{ block: UISignalCallbacksBlock }>(({ block }) => {
  const { t } = useTranslation('chat');
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  return (
    <Accordion
      gap={4}
      indicatorPlacement="inline"
      styles={{ trigger: { paddingBlock: 4, paddingInline: 4 } }}
      value={expandedKeys}
      items={[
        {
          children: (
            <Block
              className={stylex.props(styles.callbackBody).className}
              padding={12}
              style={{ marginBlock: 8 }}
              variant={'outlined'}
            >
              {block.callbacks.length === 0 ? (
                <Text type="secondary">{t('signalCallbacks.empty')}</Text>
              ) : (
                <Flexbox gap={4}>
                  {block.callbacks.map((cb) => (
                    <Flexbox
                      horizontal
                      align="flex-start"
                      className={stylex.props(styles.callbackItem).className}
                      gap={8}
                      key={cb.id}
                    >
                      {typeof cb.sequence === 'number' && (
                        <span {...stylex.props(styles.sequence)}>#{cb.sequence}</span>
                      )}
                      <Flexbox flex={1}>
                        <Markdown variant="chat">{cb.content}</Markdown>
                      </Flexbox>
                    </Flexbox>
                  ))}
                </Flexbox>
              )}
            </Block>
          ),
          key: 'signal-callbacks',
          title: (
            <Flexbox horizontal align="center" gap={8}>
              <Block
                horizontal
                align="center"
                flex="none"
                gap={4}
                height={24}
                justify="center"
                style={{ fontSize: 12 }}
                variant="outlined"
                width={24}
              >
                <Icon color={cssVar.colorTextSecondary} icon={Radio} />
              </Block>
              <Text as="span" type="secondary">
                {t('signalCallbacks.title', {
                  count: block.callbacks.length,
                  tool: block.sourceToolName,
                })}
              </Text>
            </Flexbox>
          ),
        },
      ]}
      onValueChange={setExpandedKeys}
    />
  );
});

SignalCallbacks.displayName = 'SignalCallbacks';

export default SignalCallbacks;
