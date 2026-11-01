'use client';

import { CopyButton } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

const styles = stylex.create({
  codeBlock: {
    display: 'flex',
    flex: 'none',
    gap: '12px',
    alignItems: 'center',
    minWidth: '0',
    paddingBlock: '12px',
    paddingInline: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  command: {
    overflow: 'hidden',
    flex: '1',
    minWidth: '0',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeSM,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

interface CommandLineProps {
  command: string;
}

const CommandLine = memo<CommandLineProps>(({ command }) => (
  <div {...stylex.props(styles.codeBlock)}>
    <code {...stylex.props(styles.command)}>{command}</code>
    <CopyButton content={command} size={'small'} />
  </div>
));

CommandLine.displayName = 'CommandLine';

export default CommandLine;
