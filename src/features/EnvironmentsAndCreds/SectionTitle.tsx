'use client';

import { Text } from '@lobehub/ui';
import { memo } from 'react';

interface SectionTitleProps {
  title: string;
}

/**
 * The name of one section on the Environments & Credentials page. It sits in
 * the section's header row, left of that section's own actions.
 */
const SectionTitle = memo<SectionTitleProps>(({ title }) => (
  <Text as={'h2'} fontSize={16} style={{ flex: 1, margin: 0, minWidth: 0 }} weight={600}>
    {title}
  </Text>
));

SectionTitle.displayName = 'EnvironmentsAndCredsSectionTitle';

export default SectionTitle;
