import { Icon } from '@lobehub/ui';
import { GitBranchIcon } from 'lucide-react';

import { registerIntegration } from '../registry';

export const TfsIcon = ({ size = 24 }: { size?: number }) => (
  <Icon icon={GitBranchIcon} size={size} />
);
registerIntegration({
  docsUrl: 'https://learn.microsoft.com/azure/devops/',
  icon: TfsIcon,
  id: 'tfs',
  name: 'TFS / Azure DevOps',
});
