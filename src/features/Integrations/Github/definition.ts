import { Github } from '@lobehub/icons';

import { type IntegrationDefinition, registerIntegration } from '../registry';

export const GITHUB_INTEGRATION: IntegrationDefinition = {
  docsUrl: 'https://lobehub.com/docs/usage/integrations/github',
  icon: Github,
  id: 'github',
  keywords: ['github', 'git', 'pull request', 'pr', 'ci', 'review', 'merge', 'repository'],
  name: 'GitHub',
};

registerIntegration(GITHUB_INTEGRATION);
