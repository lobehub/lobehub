import { type IntegrationDefinition, registerIntegration } from '../registry';
import LinearIcon from './LinearIcon';

export const LINEAR_INTEGRATION: IntegrationDefinition = {
  docsUrl: 'https://lobehub.com/docs/usage/integrations/linear',
  icon: LinearIcon,
  id: 'linear',
  name: 'Linear',
};

registerIntegration(LINEAR_INTEGRATION);
