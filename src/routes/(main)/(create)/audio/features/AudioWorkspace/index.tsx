'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import ConfigPanel from '../ConfigPanel';
import GenerationFeed from '../GenerationFeed';

const AudioWorkspace = memo(() => (
  <Flexbox height="100%" horizontal>
    <div style={{ width: '300px', borderRight: '1px solid var(--colorBorder)' }}>
      <ConfigPanel />
    </div>
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <GenerationFeed />
    </div>
  </Flexbox>
));

AudioWorkspace.displayName = 'AudioWorkspace';

export default AudioWorkspace;
