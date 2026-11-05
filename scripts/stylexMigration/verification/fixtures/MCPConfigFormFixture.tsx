import { MCPConfigForm } from 'verification:component';

const configSchema = {
  properties: {
    apiKey: {
      description:
        'Your **API key** from the provider dashboard.\n\nKeep it secret; it is stored only on this device.',
      title: 'API key',
      type: 'string',
    },
    region: {
      description: 'Pick the region closest to you.',
      enum: ['us', 'eu'],
      type: 'string',
    },
    timeout: { minimum: 1, maximum: 60, type: 'number' },
  },
  required: ['apiKey', 'region', 'timeout'],
};

export const Fixture = () => <MCPConfigForm configSchema={configSchema} identifier="fixture-mcp" />;
