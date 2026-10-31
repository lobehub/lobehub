'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ListChecksIcon } from 'lucide-react';
import { memo } from 'react';

import StreamingMarkdown from '@/components/StreamingMarkdown';

import type { CreatePlanParams } from '../../../types';

const styles = stylex.create({
  container: {
    overflow: 'hidden',
    padding: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: '8px',
  },
  description: { fontSize: '14px', color: cssVar.colorTextSecondary },
  header: { display: 'flex', gap: '8px', alignItems: 'center', paddingBlock: '4px' },
  title: {
    overflow: 'hidden',
    fontSize: '16px',
    fontWeight: 500,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

export const CreatePlanStreaming = memo<BuiltinStreamingProps<CreatePlanParams>>(({ args }) => {
  const { goal, description, context } = args || {};

  if (!goal) return null;

  return (
    <Flexbox className={stylex.props(styles.container).className} gap={8}>
      {/* Header */}
      <div {...stylex.props(styles.header)}>
        <Icon icon={ListChecksIcon} size={18} />
        <Text ellipsis className={stylex.props(styles.title).className}>
          {goal}
        </Text>
      </div>

      {/* Description */}
      {description && (
        <Text className={stylex.props(styles.description).className} ellipsis={{ rows: 2 }}>
          {description}
        </Text>
      )}

      {/* Context content - streaming with animation */}
      <StreamingMarkdown maxHeight={100}>{context}</StreamingMarkdown>
    </Flexbox>
  );
});

CreatePlanStreaming.displayName = 'CreatePlanStreaming';

export default CreatePlanStreaming;
