import { useTopicDrawerPortalHostViewType } from '@/features/AgentTasks/hooks/useTopicDrawerArtifactPortal';
import { PortalContent } from '@/features/Portal/router';

import Body from '../features/Body';

const Layout = () => {
  const viewType = useTopicDrawerPortalHostViewType();

  return <PortalContent renderBody={(body) => <Body>{body}</Body>} viewType={viewType} />;
};

export default Layout;
