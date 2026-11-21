import NavItem from '@/features/NavPanel/components/NavItem';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import { AppIcon } from './AppIcon';
import { getAppHome, hasAppConnection } from './catalog';
import { useMarketplaceApps } from './useMarketplaceApps';

export default function ConnectedAppNav({ selected }: { selected?: string }) {
  const { apps } = useMarketplaceApps();
  return apps.filter(hasAppConnection).map((app) => (
    <WorkspaceLink key={app.id} to={getAppHome(app)}>
      <NavItem active={selected === app.id} icon={() => <AppIcon app={app} />} title={app.name} />
    </WorkspaceLink>
  ));
}
