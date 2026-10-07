'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { type ReactNode } from 'react';

const styles = createStaticStyles(({ css }) => ({
  actions: css`
    flex: none;
  `,
  description: css`
    max-width: 720px;
    margin: 0;

    font-size: ${cssVar.fontSize};
    line-height: ${cssVar.lineHeight};
    color: ${cssVar.colorTextSecondary};
  `,
  eyebrow: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  page: css`
    width: 100%;
    max-width: 1120px;
    margin-inline: auto;
    padding-block: 24px 48px;
    padding-inline: 32px;

    @media (width <= 768px) {
      padding-block: 16px 32px;
      padding-inline: 16px;
    }
  `,
  title: css`
    overflow: hidden;

    margin: 0;

    font-size: ${cssVar.fontSizeHeading3};
    font-weight: ${cssVar.fontWeightStrong};
    line-height: 1.3;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
  `,
}));

export interface EvalPageHeaderProps {
  /** Actions on the object — kept apart from identity, on the right. */
  actions?: ReactNode;
  /** Location: breadcrumb or back link, above the title. */
  breadcrumb?: ReactNode;
  description?: ReactNode;
  /** Leading avatar / icon for the object. */
  icon?: ReactNode;
  /** State of the object (status, counts) on the line under the title. */
  meta?: ReactNode;
  title: ReactNode;
}

/**
 * Header shared by every eval page: location, then identity, then state —
 * with actions on their own side so they never read as a description.
 */
export const EvalPageHeader = ({
  actions,
  breadcrumb,
  description,
  icon,
  meta,
  title,
}: EvalPageHeaderProps) => (
  <Flexbox gap={12}>
    {breadcrumb && <div className={styles.eyebrow}>{breadcrumb}</div>}
    <Flexbox horizontal align="flex-start" gap={16} justify="space-between" wrap="wrap">
      <Flexbox horizontal align="flex-start" flex={1} gap={12} style={{ minWidth: 0 }}>
        {icon}
        <Flexbox flex={1} gap={6} style={{ minWidth: 0 }}>
          <h1 className={styles.title}>{title}</h1>
          {meta}
          {description && <p className={styles.description}>{description}</p>}
        </Flexbox>
      </Flexbox>
      {actions && (
        <Flexbox horizontal align="center" className={styles.actions} gap={8}>
          {actions}
        </Flexbox>
      )}
    </Flexbox>
  </Flexbox>
);

export interface EvalPageProps {
  children?: ReactNode;
  header?: ReactNode;
}

/** Centered, width-capped page column with the module's section rhythm. */
const EvalPage = ({ children, header }: EvalPageProps) => (
  <Flexbox className={styles.page} gap={32}>
    {header}
    {children}
  </Flexbox>
);

export default EvalPage;
