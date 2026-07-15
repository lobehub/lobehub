import { Text } from '@lobehub/ui';
import { memo, type PropsWithChildren } from 'react';

const WorkspaceSettingsTitle = memo<PropsWithChildren>(({ children }) => (
  <Text strong as="h2" style={{ fontSize: 20, margin: 0 }}>
    {children}
  </Text>
));

WorkspaceSettingsTitle.displayName = 'WorkspaceSettingsTitle';

export default WorkspaceSettingsTitle;
