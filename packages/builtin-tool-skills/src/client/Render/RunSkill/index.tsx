'use client';

import { type BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Markdown, ScrollShadow } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import type { RunSkillParams, RunSkillState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;

    width: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;

    background: ${cssVar.colorBgContainer};
  `,
  content: css`
    padding-block: 8px;
    padding-inline: 16px;
    font-size: 14px;
  `,
  description: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  header: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  name: css`
    font-weight: 500;
  `,
}));

const RunSkill = memo<BuiltinRenderProps<RunSkillParams, RunSkillState>>(
  ({ content, pluginState }) => {
    const { description, name } = pluginState || {};

    if (!name) return null;

    return (
      <Flexbox className={styles.container}>
        <Flexbox className={styles.header} gap={4}>
          <span className={styles.name}>{name}</span>
          {description && <span className={styles.description}>{description}</span>}
        </Flexbox>
        {content && (
          <ScrollShadow className={styles.content} offset={12} size={12} style={{ maxHeight: 400 }}>
            <Markdown style={{ overflow: 'unset' }} variant={'chat'}>
              {content}
            </Markdown>
          </ScrollShadow>
        )}
      </Flexbox>
    );
  },
);

export default RunSkill;
