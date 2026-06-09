import { type SharedDocumentData } from '@lobechat/types';
import { type ReactNode } from 'react';

interface PublishedShellProps {
  children: ReactNode;
  data?: SharedDocumentData;
  error?: unknown;
}

export default function PublishedShell({ children }: PublishedShellProps) {
  return <>{children}</>;
}
