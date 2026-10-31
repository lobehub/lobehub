'use client';

import { type BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Markdown, ScrollShadow } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import type { ActivateSkillParams, ActivateSkillState } from '../../../types';

const styles = stylex.create({
  container: {
    overflow: 'hidden',
    width: '100%',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '12px',
    background: cssVar.colorBgContainer,
  },
  content: { paddingBlock: '8px', paddingInline: '16px', fontSize: '14px' },
  description: { fontSize: '12px', color: cssVar.colorTextSecondary },
  header: {
    paddingBlock: '8px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  name: { fontWeight: 500 },
});

const ActivateSkill = memo<BuiltinRenderProps<ActivateSkillParams, ActivateSkillState>>(
  ({ content, pluginState }) => {
    const { description, name, title } = pluginState || {};
    const displayName = title || name;

    if (!displayName) return null;

    return (
      <Flexbox className={stylex.props(styles.container).className}>
        <Flexbox className={stylex.props(styles.header).className} gap={4}>
          <span {...stylex.props(styles.name)}>{displayName}</span>
          {description && <span {...stylex.props(styles.description)}>{description}</span>}
        </Flexbox>
        {content && (
          <ScrollShadow
            className={stylex.props(styles.content).className}
            offset={12}
            size={12}
            style={{ maxHeight: 400 }}
          >
            <Markdown style={{ overflow: 'unset' }} variant={'chat'}>
              {content}
            </Markdown>
          </ScrollShadow>
        )}
      </Flexbox>
    );
  },
);

export default ActivateSkill;
