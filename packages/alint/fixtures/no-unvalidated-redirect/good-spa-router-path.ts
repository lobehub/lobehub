// A root path from an inbox row is handed to SPA navigation (React Router `navigate`,
// via a desktop notification click); the router refuses external targets.
import { useNavigate } from 'react-router';

interface InboxRow {
  actionUrl?: string | null;
  title: string;
}

export const toNotification = (row: InboxRow, workspaceSlug: string | null) => ({
  navigate: row.actionUrl?.startsWith('/')
    ? { path: workspaceSlug ? `/${workspaceSlug}${row.actionUrl}` : row.actionUrl }
    : undefined,
  title: row.title,
});

export const useNotificationClick = () => {
  const navigate = useNavigate();

  return (target?: { path: string }) => {
    if (!target?.path) return;
    navigate(target.path);
  };
};
