'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { CheckCircle, Clock, XCircle } from 'lucide-react';
import { memo } from 'react';

import type { InstallPluginParams, InstallPluginState } from '../../types';

const InstallPlugin = memo<BuiltinRenderProps<InstallPluginParams, InstallPluginState>>(
  ({ pluginState }) => {
    const {
      pluginId,
      pluginName,
      installed,
      awaitingApproval,
      isKlavis,
      isLobehubSkill,
      serverStatus,
      error,
    } = pluginState || {};

    if (!pluginId) return null;

    // Error state
    if (error) {
      return (
        <Flexbox horizontal align={'center'} gap={8} style={{ fontSize: 13 }}>
          <XCircle size={14} style={{ color: 'var(--lobe-error-6)' }} />
          <span style={{ fontWeight: 500 }}>
            Failed to install plugin:{' '}
            <code
              style={{
                background: 'var(--lobe-fill-tertiary)',
                borderRadius: 4,
                color: 'var(--lobe-text)',
                fontSize: 12,
                padding: '2px 6px',
              }}
            >
              {pluginName || pluginId}
            </code>
          </span>
        </Flexbox>
      );
    }

    // Awaiting approval state
    if (awaitingApproval) {
      return (
        <Flexbox horizontal align={'center'} gap={8} style={{ fontSize: 13 }}>
          <Clock size={14} style={{ color: 'var(--lobe-warning-6)' }} />
          <span style={{ fontWeight: 500 }}>
            {isKlavis || isLobehubSkill ? (
              <>
                Waiting for authorization:{' '}
                <code
                  style={{
                    background: 'var(--lobe-fill-tertiary)',
                    borderRadius: 4,
                    color: 'var(--lobe-text)',
                    fontSize: 12,
                    padding: '2px 6px',
                  }}
                >
                  {pluginName || pluginId}
                </code>
                {serverStatus === 'pending_auth' && (
                  <span style={{ color: 'var(--lobe-text-tertiary)', marginLeft: 8 }}>
                    (OAuth required)
                  </span>
                )}
              </>
            ) : (
              <>
                Waiting for installation approval:{' '}
                <code
                  style={{
                    background: 'var(--lobe-fill-tertiary)',
                    borderRadius: 4,
                    color: 'var(--lobe-text)',
                    fontSize: 12,
                    padding: '2px 6px',
                  }}
                >
                  {pluginName || pluginId}
                </code>
              </>
            )}
          </span>
        </Flexbox>
      );
    }

    // Installed state
    if (installed) {
      return (
        <Flexbox horizontal align={'center'} gap={8} style={{ fontSize: 13 }}>
          <CheckCircle size={14} style={{ color: 'var(--lobe-success-6)' }} />
          <span style={{ fontWeight: 500 }}>
            {isKlavis || isLobehubSkill ? 'Connected and enabled' : 'Installed and enabled'}:{' '}
            <code
              style={{
                background: 'var(--lobe-fill-tertiary)',
                borderRadius: 4,
                color: 'var(--lobe-text)',
                fontSize: 12,
                padding: '2px 6px',
              }}
            >
              {pluginName || pluginId}
            </code>
          </span>
        </Flexbox>
      );
    }

    return null;
  },
);

export default InstallPlugin;
