import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import AgentDocumentsGroup from './AgentDocumentsGroup';

export type ResourceViewMode = 'list' | 'tree';

const ResourcesSection = memo(() => {
  return (
    <Flexbox data-testid="workspace-resources" paddingBlock={8} paddingInline={16}>
      <AgentDocumentsGroup viewMode={'list'} />
    </Flexbox>
  );
});

ResourcesSection.displayName = 'ResourcesSection';

export default ResourcesSection;
