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
  return (
    <Flexbox paddingInline={4}>
      <Accordion defaultExpandedKeys={[GroupKey.Project, GroupKey.Agent]} gap={8}>
        <Agent itemKey={GroupKey.Agent} />
        <BottomMenu />
      </Accordion>
    </Flexbox>
  );
});

export default Body;
