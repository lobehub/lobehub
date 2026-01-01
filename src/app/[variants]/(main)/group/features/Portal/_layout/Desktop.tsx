import { PortalContent } from '@/features/Portal/router';

import Body from '../features/Body';

const Layout = () => {
  return (
    <PortalContent renderBody={(body) => <Body>{body}</Body>} />
  );
};

export default Layout;
