'use client';

import { Accordion, Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import Agent from './Agent';
import BottomMenu from './BottomMenu';

export enum GroupKey {
  Agent = 'agent',
  Project = 'project',
}

const Body = memo(() => {
  // const { enableKnowledgeBase } = useServerConfigStore(featureFlagsSelectors);
  return (
    <Flexbox paddingInline={4}>
      <Accordion defaultExpandedKeys={[GroupKey.Project, GroupKey.Agent]} gap={8}>
        {/*{enableKnowledgeBase && <Repo itemKey={GroupKey.Project} />}*/}
        <Agent itemKey={GroupKey.Agent} />
        <BottomMenu />
      </Accordion>
    </Flexbox>
  );
});

export default Body;
