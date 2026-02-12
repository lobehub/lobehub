import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { CheckCircle, XCircle } from 'lucide-react';
import { memo } from 'react';

import type { UpdateAgentConfigParams, UpdateConfigState } from '../../types';
import ConfigDiffView from './components/ConfigDiffView';

const UpdateConfig = memo<BuiltinRenderProps<UpdateAgentConfigParams, UpdateConfigState>>(
  ({ pluginState }) => {
    const { config, meta, togglePlugin } = pluginState || {};

    const hasConfig = config && config.updatedFields.length > 0;
    const hasMeta = meta && meta.updatedFields.length > 0;
    const hasTogglePlugin = togglePlugin && togglePlugin.pluginId;

    if (!hasConfig && !hasMeta && !hasTogglePlugin) {
      return null;
    }

    return (
      <Flexbox gap={8}>
        {hasTogglePlugin && (
          <Flexbox horizontal align={'center'} gap={8} style={{ fontSize: 13 }}>
            {togglePlugin.enabled ? (
              <CheckCircle size={14} style={{ color: 'var(--lobe-success-6)' }} />
            ) : (
              <XCircle size={14} style={{ color: 'var(--lobe-text-tertiary)' }} />
            )}
            <span style={{ fontWeight: 500 }}>
              {togglePlugin.enabled ? 'Enabled' : 'Disabled'} plugin:{' '}
              <code
                style={{
                  background: 'var(--lobe-fill-tertiary)',
                  borderRadius: 4,
                  color: 'var(--lobe-text)',
                  fontSize: 12,
                  padding: '2px 6px',
                }}
              >
                {togglePlugin.pluginId}
              </code>
            </span>
          </Flexbox>
        )}
        {hasConfig && (
          <ConfigDiffView
            newValues={config.newValues}
            previousValues={config.previousValues}
            updatedFields={config.updatedFields}
          />
        )}
        {hasMeta && (
          <ConfigDiffView
            newValues={meta.newValues}
            previousValues={meta.previousValues}
            updatedFields={meta.updatedFields}
          />
        )}
      </Flexbox>
    );
  },
);

export default UpdateConfig;
