const CURSOR_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2'];

export interface CollaborationUser {
  color: string;
  name: string;
  userId?: string;
}

const hashIdentity = (identity: string) => {
  let hash = 0;

  for (const char of identity) {
    hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  }

  return hash;
};

export const resolveCollaborationUser = ({
  displayName,
  userId,
}: {
  displayName?: string;
  userId?: string;
}): CollaborationUser => {
  const name = displayName?.trim() || 'Anonymous';
  const identity = userId || name;

  return {
    color: CURSOR_COLORS[hashIdentity(identity) % CURSOR_COLORS.length],
    name,
    userId,
  };
};
