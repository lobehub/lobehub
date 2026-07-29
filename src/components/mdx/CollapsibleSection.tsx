'use client';

import { Collapse } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { kebabCase } from 'es-toolkit';
import { type FC, type ReactNode } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  collapse: css`
    margin-block: 1em;
  `,
  label: css`
    font-size: 1.25em;
    font-weight: 600;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
}));

interface CollapsibleSectionProps {
  children?: ReactNode;
  title?: string;
}

/**
 * Renders a changelog section ("Improvements" / "Fixes") inside a Collapse that
 * is collapsed by default. Injected by `remarkCollapsibleSections` as the
 * `<collapsible-section>` element.
 */
const CollapsibleSection: FC<CollapsibleSectionProps> = ({ children, title = '' }) => {
  const id = kebabCase(title);

  return (
    <Collapse
      className={styles.collapse}
      defaultActiveKey={[]}
      expandIconPlacement={'end'}
      gap={8}
      variant={'outlined'}
      items={[
        {
          children,
          key: id || 'section',
          label: <span className={styles.label}>{title}</span>,
        },
      ]}
    />
  );
};

CollapsibleSection.displayName = 'CollapsibleSection';

export default CollapsibleSection;
