import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Tag } from '@lobehub/ui';
import { memo } from 'react';

import type { GetAvailableModelsParams, GetAvailableModelsState } from '../../types';

const GetAvailableModels = memo<
  BuiltinRenderProps<GetAvailableModelsParams, GetAvailableModelsState>
>(({ pluginState }) => {
  const { providers } = pluginState || {};

  if (!providers || providers.length === 0) {
    return (
      <Flexbox style={{ color: 'var(--lobe-text-secondary)', fontSize: 13 }}>
        No available models found.
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={12} style={{ fontSize: 13 }}>
      {providers.map((provider) => (
        <Flexbox gap={8} key={provider.id}>
          <Flexbox horizontal align="center" gap={8}>
            <span style={{ fontWeight: 600 }}>{provider.name}</span>
            <Tag color="blue" style={{ margin: 0 }}>
              {provider.models.length} models
            </Tag>
          </Flexbox>
          <Flexbox
            gap={4}
            style={{
              background: 'var(--lobe-fill-tertiary)',
              borderRadius: 6,
              maxHeight: 200,
              overflow: 'auto',
              padding: 8,
            }}
          >
            {provider.models.map((model) => (
              <Flexbox horizontal align="center" gap={8} key={model.id} style={{ fontSize: 12 }}>
                <code style={{ color: 'var(--lobe-text)' }}>{model.id}</code>
                {model.abilities?.vision && (
                  <Tag color="purple" style={{ fontSize: 10, margin: 0 }}>
                    vision
                  </Tag>
                )}
                {model.abilities?.functionCall && (
                  <Tag color="green" style={{ fontSize: 10, margin: 0 }}>
                    tools
                  </Tag>
                )}
                {model.abilities?.reasoning && (
                  <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>
                    reasoning
                  </Tag>
                )}
              </Flexbox>
            ))}
          </Flexbox>
        </Flexbox>
      ))}
    </Flexbox>
  );
});

export default GetAvailableModels;
