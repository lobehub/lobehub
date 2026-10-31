'use client';

import type { BuiltinPlaceholderProps } from '@lobechat/types';
import { Block, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import type { GenerateVideoParams } from '../../types';
import { GenerationProgress } from '../components/GenerationProgress';

const styles = stylex.create({
  body: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '180px',
    padding: '20px',
    background: cssVar.colorFillTertiary,
  },
  header: {
    minWidth: '0',
    paddingBlock: '8px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  model: {
    overflow: 'hidden',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  prompt: {
    overflow: 'hidden',
    fontSize: '14px',
    fontWeight: 500,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

interface GenerateVideoPlaceholderProps extends BuiltinPlaceholderProps<GenerateVideoParams> {
  toolCallId?: string;
}

export const GenerateVideoPlaceholder = memo<GenerateVideoPlaceholderProps>(
  ({ args, toolCallId }) => {
    const model = [args?.provider, args?.model].filter(Boolean).join('/');

    return (
      <Block variant={'outlined'} width={'100%'}>
        <Flexbox className={stylex.props(styles.header).className} gap={2}>
          <span {...stylex.props(styles.prompt)}>{args?.prompt}</span>
          {model && <span {...stylex.props(styles.model)}>{model}</span>}
        </Flexbox>
        <div {...stylex.props(styles.body)}>
          <GenerationProgress
            estimatedDurationMs={args?.estimatedDurationMs}
            toolCallId={toolCallId}
          />
        </div>
      </Block>
    );
  },
);

GenerateVideoPlaceholder.displayName = 'GenerateVideoPlaceholder';
