import { eq } from 'drizzle-orm';

import { users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

const splitList = (value?: string) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

const superAdminPrincipals = () => splitList(process.env.ACENSUS_SUPER_ADMINS);

export const isSuperAdminPrincipal = (params: {
  email?: string | null;
  normalizedEmail?: string | null;
  role?: string | null;
  userId: string;
}) => {
  const principals = superAdminPrincipals();
  const userId = params.userId.toLowerCase();
  const email = params.email?.toLowerCase();
  const normalizedEmail = params.normalizedEmail?.toLowerCase();

  return (
    params.role === 'super_admin' ||
    params.role === 'acensus_super_admin' ||
    principals.includes(userId) ||
    (email ? principals.includes(email) : false) ||
    (normalizedEmail ? principals.includes(normalizedEmail) : false)
  );
};

export const isSuperAdmin = async (db: LobeChatDatabase, userId: string) => {
  const user = await db.query.users.findFirst({
    columns: { email: true, normalizedEmail: true, role: true },
    where: eq(users.id, userId),
  });

  return isSuperAdminPrincipal({
    email: user?.email,
    normalizedEmail: user?.normalizedEmail,
    role: user?.role,
    userId,
  });
};
