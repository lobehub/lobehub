'use client';

import type { BuiltinPlaceholderProps } from '@lobechat/types';
import { Block, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import type { GenerateVideoParams } from '../../types';
import { GenerationProgress } from '../components/GenerationProgress';

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    display: flex;
    align-items: center;
    justify-content: center;

    min-height: 180px;
    padding: 20px;

    background: ${cssVar.colorFillTertiary};
  `,
  header: css`
    min-width: 0;
    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  model: css`
    overflow: hidden;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  prompt: css`
    overflow: hidden;

    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface GenerateVideoPlaceholderProps extends BuiltinPlaceholderProps<GenerateVideoParams> {
  toolCallId?: string;
}

export const GenerateVideoPlaceholder = memo<GenerateVideoPlaceholderProps>(
  ({ args, toolCallId }) => {
    const model = [args?.provider, args?.model].filter(Boolean).join('/');

    return (
      <Block variant={'outlined'} width={'100%'}>
        <Flexbox className={styles.header} gap={2}>
          <span className={styles.prompt}>{args?.prompt}</span>
          {model && <span className={styles.model}>{model}</span>}
        </Flexbox>
        <div className={styles.body}>
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
