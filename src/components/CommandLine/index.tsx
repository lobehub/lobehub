'use client';

import { CopyButton } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

const styles = createStaticStyles(({ css }) => ({
  codeBlock: css`
    display: flex;
    flex: none;
    gap: 12px;
    align-items: center;

    min-width: 0;
    padding-block: 12px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorFillQuaternary};
  `,
  command: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface CommandLineProps {
  command: string;
}

const CommandLine = memo<CommandLineProps>(({ command }) => (
  <div className={styles.codeBlock}>
    <code className={styles.command}>{command}</code>
    <CopyButton content={command} size={'small'} />
  </div>
));

CommandLine.displayName = 'CommandLine';

export default CommandLine;
