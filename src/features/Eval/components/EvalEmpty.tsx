'use client';

import { Center, Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { type LucideIcon } from 'lucide-react';
import { type ReactNode } from 'react';

const styles = createStaticStyles(({ css }) => ({
  compact: css`
    padding-block: 24px;
  `,
  description: css`
    max-width: 420px;
    margin: 0;

    font-size: ${cssVar.fontSizeSM};
    line-height: ${cssVar.lineHeightSM};
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  icon: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  root: css`
    padding-block: 40px;
    padding-inline: 24px;
    border: 1px dashed ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  title: css`
    font-size: ${cssVar.fontSize};
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
}));

export interface EvalEmptyProps {
  /** The next step — usually one primary or default button. */
  action?: ReactNode;
  /** Smaller padding for an empty list inside a populated page. */
  compact?: boolean;
  description?: ReactNode;
  icon: LucideIcon;
  title: ReactNode;
}

/**
 * First-use empty state: what this area holds, why it is empty, and the one
 * action that fills it. Not for failures — those use `AsyncError`.
 */
const EvalEmpty = ({ action, compact, description, icon, title }: EvalEmptyProps) => (
  <Center className={compact ? `${styles.root} ${styles.compact}` : styles.root} gap={12}>
    <div className={styles.icon}>
      <Icon icon={icon} size={20} />
    </div>
    <Flexbox align="center" gap={4}>
      <span className={styles.title}>{title}</span>
      {description && <p className={styles.description}>{description}</p>}
    </Flexbox>
    {action}
  </Center>
);

export default EvalEmpty;
