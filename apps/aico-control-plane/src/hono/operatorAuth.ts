import { Hono } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import { PlatformAdminUserModel } from '@/database/models/platformAdminUser';
import {
  createSessionToken,
  hashOperatorPassword,
  hashSessionToken,
  meetsOperatorPasswordComplexity,
  verifyOperatorPassword,
} from '@/database/utils/operatorPassword';

import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  parseCookieValue,
  serializeAdminSessionCookie,
  serializeClearedAdminSessionCookie,
} from './adminSession';

const jsonError = (message: string, status: number) =>
  new Response(JSON.stringify({ error: { message } }), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });

const readEmailPassword = async (request: Request) => {
  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
    password?: unknown;
  } | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  return { email, password };
};

export const createOperatorAuthApp = () => {
  const app = new Hono();

  app.post('/sign-in', async (c) => {
    const { email, password } = await readEmailPassword(c.req.raw);
    if (!email || !password) return jsonError('EMAIL_PASSWORD_REQUIRED', 400);

    const db = await getServerDB();
    const model = new PlatformAdminUserModel(db);
    const admin = await model.findByEmail(email);
    if (!admin || admin.banned) return jsonError('INVALID_CREDENTIALS', 401);
    const ok = await verifyOperatorPassword(password, admin.passwordHash);
    if (!ok) return jsonError('INVALID_CREDENTIALS', 401);

    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000);
    await model.createSession({
      adminUserId: admin.id,
      expiresAt,
      ipAddress:
        c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip'),
      tokenHash: hashSessionToken(token),
      userAgent: c.req.header('user-agent'),
    });

    return new Response(JSON.stringify({ email: admin.email, ok: true }), {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': serializeAdminSessionCookie(token),
      },
      status: 200,
    });
  });

  app.post('/sign-out', async (c) => {
    const token = parseCookieValue(c.req.header('cookie') ?? null, ADMIN_SESSION_COOKIE);
    if (token) {
      const db = await getServerDB();
      await new PlatformAdminUserModel(db).deleteSessionByTokenHash(hashSessionToken(token));
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': serializeClearedAdminSessionCookie(),
      },
      status: 200,
    });
  });

  return app;
};

export const ensureBootstrapAdmin = async () => {
  const email = process.env.AICO_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.AICO_BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return;
  if (!meetsOperatorPasswordComplexity(password)) {
    console.warn(
      '[control-plane] AICO_BOOTSTRAP_ADMIN_PASSWORD is too weak (min 8 chars, letter + digit); skipping bootstrap',
    );
    return;
  }

  const db = await getServerDB();
  const model = new PlatformAdminUserModel(db);
  const passwordHash = await hashOperatorPassword(password);
  await model.upsertByEmail({ email, passwordHash });
  console.info(`[control-plane] bootstrap operator ready for ${email}`);
};
