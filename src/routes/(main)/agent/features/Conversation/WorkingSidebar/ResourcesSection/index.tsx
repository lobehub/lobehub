import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import AgentDocumentsGroup from './AgentDocumentsGroup';

export type ResourceViewMode = 'list' | 'tree';

const ResourcesSection = memo(() => {
  return (
    <Flexbox
      data-testid="workspace-resources"
      flex={1}
      paddingBlock={8}
      paddingInline={16}
      style={{ minHeight: 0 }}
    >
      <AgentDocumentsGroup style={{ flex: 1, minHeight: 0 }} viewMode={'list'} />
    </Flexbox>
  );
});

ResourcesSection.displayName = 'ResourcesSection';

export default ResourcesSection;
