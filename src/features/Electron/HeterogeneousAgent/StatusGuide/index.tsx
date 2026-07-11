'use client';

import { HeterogeneousAgentSessionErrorCode } from '@lobechat/electron-client-ipc';
import { memo } from 'react';

import { resolveHeterogeneousAgentGuideConfig } from './config';
import AuthRequiredState from './states/AuthRequiredState';
import CliInstallState from './states/CliInstallState';
import OverloadedState from './states/OverloadedState';
import RateLimitState from './states/RateLimitState';
import type { HeterogeneousAgentStatusGuideProps } from './types';

const HeterogeneousAgentStatusGuide = memo<HeterogeneousAgentStatusGuideProps>(
  ({
    agentType = 'codex',
    autoRetry,
    error,
    onOpenSystemTools,
    onRetry,
    schedule,
    variant = 'inline',
  }) => {
    const config = resolveHeterogeneousAgentGuideConfig({
      agentType,
      errorAgentType: error?.agentType,
    });
    const stateProps = {
      autoRetry,
      config,
      error,
      onOpenSystemTools,
      onRetry,
      schedule,
      variant,
    };

    switch (error?.code) {
      case HeterogeneousAgentSessionErrorCode.AuthRequired: {
        return <AuthRequiredState {...stateProps} />;
      }

      case HeterogeneousAgentSessionErrorCode.RateLimit: {
        return <RateLimitState {...stateProps} />;
      }

      case HeterogeneousAgentSessionErrorCode.Overloaded: {
        return <OverloadedState {...stateProps} />;
      }

      default: {
        return <CliInstallState {...stateProps} />;
      }
    }
  },
);

HeterogeneousAgentStatusGuide.displayName = 'HeterogeneousAgentStatusGuide';

export default HeterogeneousAgentStatusGuide;
