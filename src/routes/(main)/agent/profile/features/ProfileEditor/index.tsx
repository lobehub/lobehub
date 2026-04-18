'use client';

import { Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import isEqual from 'fast-deep-equal';
import React, { memo } from 'react';

import ModelSelect from '@/features/ModelSelect';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import AgentCronJobs from '../AgentCronJobs';
import AgentSettings from '../AgentSettings';
import EditorCanvas from '../EditorCanvas';
import AgentHeader from './AgentHeader';
import AgentTool from './AgentTool';
import CCStatusCard from './CCStatusCard';

const ProfileEditor = memo(() => {
  const config = useAgentStore(agentSelectors.currentAgentConfig, isEqual);
  const updateConfig = useAgentStore((s) => s.updateAgentConfig);
  const isHeterogeneous = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);

  return (
    <>
      <Flexbox
        style={{ cursor: 'default', marginBottom: 12 }}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        {/* Header: Avatar + Name + Description */}
        <AgentHeader />
        {isHeterogeneous ? (
          // CC integration mode: show CLI version + path instead of model/skills pickers
          <CCStatusCard />
        ) : (
          <>
            {/* Config Bar: Model Selector */}
            <Flexbox
              horizontal
              align={'center'}
              gap={8}
              justify={'flex-start'}
              style={{ marginBottom: 12 }}
            >
              <ModelSelect
                initialWidth
                popupWidth={400}
                value={{
                  model: config.model,
                  provider: config.provider,
                }}
                onChange={updateConfig}
              />
            </Flexbox>
            <AgentTool />
          </>
        )}
      </Flexbox>
      <Divider />
      {/* Main Content: Prompt Editor */}
      <EditorCanvas />
      {/* Agent Cron Jobs Display (only show if jobs exist) */}
      {enableBusinessFeatures && <AgentCronJobs />}
      {/* Advanced Settings Modal */}
      <AgentSettings />
    </>
  );
});

export default ProfileEditor;
