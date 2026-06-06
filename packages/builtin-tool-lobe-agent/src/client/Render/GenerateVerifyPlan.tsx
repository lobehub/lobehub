'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { CircleCheck } from 'lucide-react';
import { memo } from 'react';

import type { GenerateVerifyPlanState } from '../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  item: css`
    padding-block: 7px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;
  `,
  tag: css`
    flex: none;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  title: css`
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
}));

/**
 * Renders the `generateVerifyPlan` result: the delivery checks that were
 * generated for the run, each tagged as a blocking gate or an auto-fill.
 */
const GenerateVerifyPlanRender = memo<BuiltinRenderProps<unknown, GenerateVerifyPlanState>>(
  ({ pluginState }) => {
    const items = pluginState?.items;
    if (!items?.length) return null;

    return (
      <Flexbox gap={6} paddingBlock={4}>
        {items.map((item, index) => (
          <Flexbox
            horizontal
            align="center"
            className={styles.item}
            gap={8}
            justify="space-between"
            key={index}
          >
            <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
              <Icon icon={CircleCheck} size={15} />
              <span className={styles.title}>{item.title}</span>
            </Flexbox>
            <span className={styles.tag}>{item.required ? 'Delivery gate' : 'Auto-fill'}</span>
          </Flexbox>
        ))}
      </Flexbox>
    );
  },
);

GenerateVerifyPlanRender.displayName = 'GenerateVerifyPlanRender';

export default GenerateVerifyPlanRender;
