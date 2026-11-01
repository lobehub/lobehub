'use client';

import { Accordion } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { kebabCase } from 'es-toolkit';
import { type FC, type ReactNode } from 'react';

const styles = stylex.create({
  collapse: { marginBlock: '1em' },
  label: { fontSize: '1.25em', fontWeight: 600, lineHeight: 1.4, color: cssVar.colorText },
});

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
    <Accordion
      className={stylex.props(styles.collapse).className}
      defaultValue={[]}
      gap={8}
      indicatorPlacement={'end'}
      styles={{ content: { padding: '12px 16px' } }}
      variant={'outlined'}
      items={[
        {
          children,
          key: id || 'section',
          title: <span {...stylex.props(styles.label)}>{title}</span>,
        },
      ]}
    />
  );
};

CollapsibleSection.displayName = 'CollapsibleSection';

export default CollapsibleSection;
