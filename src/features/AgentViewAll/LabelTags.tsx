'use client';

import { type SidebarAgentLabel } from '@lobechat/types';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  dot: css`
    flex: none;

    width: 7px;
    height: 7px;
    border-radius: 50%;

    background: ${cssVar.colorFill};
  `,
  tag: css`
    display: inline-flex;
    gap: 5px;
    align-items: center;

    max-width: 140px;
    padding-block: 1px;
    padding-inline: 8px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 999px;

    font-size: 11px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;
  `,
}));

/** Pill-style label tags (color dot + name), shared by list rows and cards. */
const LabelTags = memo<{ labels?: SidebarAgentLabel[] }>(({ labels }) => {
  if (!labels?.length) return null;

  return (
    <>
      {labels.map((label) => (
        <span className={styles.tag} key={label.id}>
          <span
            className={styles.dot}
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
