'use client';

import { type SidebarAgentLabel } from '@lobechat/types';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

const styles = stylex.create({
  dot: {
    flex: 'none',
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    backgroundColor: cssVar.colorFill,
    backgroundImage: 'none',
  },
  tag: {
    display: 'inline-flex',
    gap: '5px',
    alignItems: 'center',
    maxWidth: '140px',
    paddingBlock: '1px',
    paddingInline: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '999px',
    fontSize: '11px',
    color: cssVar.colorTextSecondary,
    whiteSpace: 'nowrap',
  },
});

/** Pill-style label tags (color dot + name) shown on list rows. */
const LabelTags = memo<{ labels?: SidebarAgentLabel[] }>(({ labels }) => {
  if (!labels?.length) return null;

  return (
    <>
      {labels.map((label) => (
        <span {...stylex.props(styles.tag)} key={label.id}>
          <span
            className={stylex.props(styles.dot).className}
            style={label.color ? { background: label.color } : undefined}
          />
          {label.name}
        </span>
      ))}
    </>
  );
});

LabelTags.displayName = 'AgentLabelTags';

export default LabelTags;
