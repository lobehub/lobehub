'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { Block, Flexbox, Markdown, Tag } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import type { CreateAgentParams } from '../../../types';

const styles = stylex.create({
  container: { display: 'flex', flexDirection: 'column', gap: '12px' },
  field: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: '12px', fontWeight: 500, color: cssVar.colorTextSecondary },
  value: { fontSize: '13px' },
});

export const CreateAgentStreaming = memo<BuiltinStreamingProps<CreateAgentParams>>(({ args }) => {
  const { title, description, systemRole, plugins, model, provider } = args || {};

  if (!title && !description && !systemRole && !plugins?.length) return null;

  return (
    <div {...stylex.props(styles.container)}>
      {title && (
        <div {...stylex.props(styles.field)}>
          <div {...stylex.props(styles.label)}>Title</div>
          <div {...stylex.props(styles.value)}>{title}</div>
        </div>
      )}
      {description && (
        <div {...stylex.props(styles.field)}>
          <div {...stylex.props(styles.label)}>Description</div>
          <div {...stylex.props(styles.value)}>{description}</div>
        </div>
      )}
      {(model || provider) && (
        <div {...stylex.props(styles.field)}>
          <div {...stylex.props(styles.label)}>Model</div>
          <div {...stylex.props(styles.value)}>
            {provider && `${provider}/`}
            {model}
          </div>
        </div>
      )}
      {plugins && plugins.length > 0 && (
        <div {...stylex.props(styles.field)}>
          <div {...stylex.props(styles.label)}>Plugins</div>
          <Flexbox horizontal gap={4} wrap={'wrap'}>
            {plugins.map((plugin) => (
              <Tag key={plugin}>{plugin}</Tag>
            ))}
          </Flexbox>
        </div>
      )}
      {systemRole && (
        <div {...stylex.props(styles.field)}>
          <div {...stylex.props(styles.label)}>System Prompt</div>
          <Block paddingBlock={8} paddingInline={12} variant={'outlined'} width="100%">
            <Markdown animated variant={'chat'}>
              {systemRole}
            </Markdown>
          </Block>
        </div>
      )}
    </div>
  );
});

CreateAgentStreaming.displayName = 'CreateAgentStreaming';

export default CreateAgentStreaming;
