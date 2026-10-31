'use client';

import ContactListPortal from '@/features/ContactList';
import HomeNavPanelPortal from '@/features/HomeSidebar';
import MessageListPortal from '@/features/MessageList';
import { useImLayout } from '@/features/NavRail/useImLayout';
import TaskNavPortal from '@/features/TaskNav';

import NavPanel from './index';

// The Home portal is owned by the shell, not by the Home route layout: routes
// without a dedicated sidebar (for example /tasks, /agents) resolve to the
// `home` nav key, and on desktop `NavPanel` lives outside `TabHost` while the
// Home layout only mounts inside a home tab — and `Activity` unmounts effects
// for inactive tabs. Registering from the route layout leaves those tabs with
// no `home` entry at all, so the panel is stuck on the loading skeleton.
//
// Under the `im_layout` trial, `home` is the Messages conversation list and
// Contacts / the Tasks scope list are shell-owned for the same reason.
const NavPanelShell = () => {
  const imLayout = useImLayout();

  return (
    <>
      {imLayout ? (
        <>
          <MessageListPortal />
          <ContactListPortal />
          <TaskNavPortal />
        </>
      ) : (
        <HomeNavPanelPortal />
      )}
      <NavPanel />
    </>
  );
};

export default NavPanelShell;
