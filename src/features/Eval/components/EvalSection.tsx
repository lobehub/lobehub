'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { type ReactNode } from 'react';

const styles = createStaticStyles(({ css }) => ({
  count: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
  description: css`
    margin: 0;
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  title: css`
    margin: 0;

    font-size: ${cssVar.fontSizeLG};
    font-weight: ${cssVar.fontWeightStrong};
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
}));

export interface EvalSectionProps {
  actions?: ReactNode;
  children?: ReactNode;
  count?: number;
  description?: ReactNode;
  title: ReactNode;
}

/** A titled block of a page: title + count on the left, actions on the right. */
const EvalSection = ({ actions, children, count, description, title }: EvalSectionProps) => (
  <Flexbox as="section" gap={12}>
    <Flexbox horizontal align="flex-end" gap={12} justify="space-between" wrap="wrap">
      <Flexbox gap={2}>
        <Flexbox horizontal align="baseline" gap={8}>
          <h2 className={styles.title}>{title}</h2>
          {typeof count === 'number' && <span className={styles.count}>{count}</span>}
        </Flexbox>
        {description && <p className={styles.description}>{description}</p>}
      </Flexbox>
      {actions && (
        <Flexbox horizontal align="center" gap={8}>
          {actions}
        </Flexbox>
      )}
    </Flexbox>
    {children}
  </Flexbox>
);

export default EvalSection;
