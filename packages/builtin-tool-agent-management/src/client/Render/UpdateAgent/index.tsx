'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Markdown } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import type { UpdateAgentParams } from '../../../types';

const styles = stylex.create({
  container: { padding: '12px', borderRadius: '8px', background: cssVar.colorFillQuaternary },
  field: { marginBlockEnd: { 'default': '8px', ':last-child': '0' } },
  label: {
    marginBlockEnd: '4px',
    fontSize: '12px',
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
  },
  value: { fontSize: '13px' },
});

const safeParse = (val: unknown): Record<string, any> | undefined => {
  if (!val) return undefined;
  if (typeof val === 'object') return val as Record<string, any>;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return typeof parsed === 'object' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
};

export const UpdateAgentRender = memo<BuiltinRenderProps<UpdateAgentParams>>(({ args }) => {
  const config = safeParse(args?.config);
  const meta = safeParse(args?.meta);

  const hasConfig = config && Object.keys(config).length > 0;
  const hasMeta = meta && Object.keys(meta).length > 0;

  if (!hasConfig && !hasMeta) return null;

  return (
    <div {...stylex.props(styles.container)}>
      {meta?.title && (
        <div {...stylex.props(styles.field)}>
          <div {...stylex.props(styles.label)}>Title</div>
          <div {...stylex.props(styles.value)}>{meta.title}</div>
        </div>
      )}
      {meta?.description && (
        <div {...stylex.props(styles.field)}>
          <div {...stylex.props(styles.label)}>Description</div>
          <div {...stylex.props(styles.value)}>{meta.description}</div>
        </div>
      )}
      {config?.systemRole && (
        <div {...stylex.props(styles.field)}>
          <div {...stylex.props(styles.label)}>System Prompt</div>
          <Block paddingBlock={8} paddingInline={12} variant={'outlined'} width="100%">
            <Markdown fontSize={13} variant={'chat'}>
              {config.systemRole as string}
            </Markdown>
          </Block>
        </div>
      )}
      {config?.model && (
        <div {...stylex.props(styles.field)}>
          <div {...stylex.props(styles.label)}>Model</div>
          <div {...stylex.props(styles.value)}>{config.model as string}</div>
        </div>
      )}
    </div>
  );
});

UpdateAgentRender.displayName = 'UpdateAgentRender';

export default UpdateAgentRender;
