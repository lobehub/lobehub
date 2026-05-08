'use client';

import { HeterogeneousAgentSessionErrorCode } from '@lobechat/electron-client-ipc';
import { memo } from 'react';

import { resolveHeterogeneousAgentGuideConfig } from './config';
import AuthRequiredState from './states/AuthRequiredState';
import CliInstallState from './states/CliInstallState';
import RateLimitState from './states/RateLimitState';
import type { HeterogeneousAgentStatusGuideProps } from './types';

const HeterogeneousAgentStatusGuide = memo<HeterogeneousAgentStatusGuideProps>(
  ({ agentType = 'codex', error, onOpenSystemTools, variant = 'inline' }) => {
    const config = resolveHeterogeneousAgentGuideConfig({
      agentType,
      errorAgentType: error?.agentType,
    });
    const stateProps = {
      config,
      error,
      onOpenSystemTools,
      variant,
    };

    switch (error?.code) {
      case HeterogeneousAgentSessionErrorCode.AuthRequired: {
        return <AuthRequiredState {...stateProps} />;
      }

      case HeterogeneousAgentSessionErrorCode.RateLimit: {
        return <RateLimitState {...stateProps} />;
      }

      default: {
        return <CliInstallState {...stateProps} />;
      }
    }
  },
);

HeterogeneousAgentStatusGuide.displayName = 'HeterogeneousAgentStatusGuide';

export default HeterogeneousAgentStatusGuide;
