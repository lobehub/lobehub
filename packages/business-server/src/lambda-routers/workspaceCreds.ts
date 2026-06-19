import { createHash } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import {
  assertWorkspaceMember,
  assertWorkspaceOwner,
  getWorkspaceSettings,
  updateWorkspaceSettings,
  type WorkspaceControlContext,
} from './_workspaceControl';

interface WorkspaceCredential {
  createdAt: string;
  description?: string;
  fileHashId?: string;
  fileName?: string;
  id: number;
  key: string;
  name: string;
  oauthConnectionId?: number;
  type: 'file' | 'kv-env' | 'kv-header' | 'oauth';
  updatedAt: string;
  values?: Record<string, string>;
}

const credsProcedure = authedProcedure.use(serverDatabase);

const getCreds = async (
  ctx: WorkspaceControlContext,
  workspaceId: string,
): Promise<WorkspaceCredential[]> => {
  const settings = await getWorkspaceSettings(ctx, workspaceId);
  return Array.isArray(settings.workspaceCreds)
    ? (settings.workspaceCreds as WorkspaceCredential[])
    : [];
};

const saveCreds = async (
  ctx: WorkspaceControlContext,
  workspaceId: string,
  creds: WorkspaceCredential[],
) => {
  await updateWorkspaceSettings(ctx, workspaceId, { workspaceCreds: creds });
};

const publicCred = (cred: WorkspaceCredential, decrypt?: boolean) => ({
  ...cred,
  values: decrypt ? cred.values : undefined,
});

const nextId = (creds: WorkspaceCredential[]) => Math.max(0, ...creds.map((cred) => cred.id)) + 1;

const workspaceInput = z.object({ workspaceId: z.string().optional() }).optional();
const resolveWorkspaceId = (
  ctx: { workspaceId?: string | null },
  input?: { workspaceId?: string },
) => {
  const workspaceId = input?.workspaceId || ctx.workspaceId;
  if (!workspaceId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Workspace is required' });

  return workspaceId;
};

export const workspaceCredsRouter = router({
  createFile: credsProcedure
    .input(
      z.object({
        description: z.string().optional(),
        fileHashId: z.string().length(64),
        fileName: z.string().min(1),
        key: z.string().min(1).max(100),
        name: z.string().min(1).max(255),
        workspaceId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workspaceId = resolveWorkspaceId(ctx, input);
      await assertWorkspaceOwner(ctx, workspaceId);
      const creds = await getCreds(ctx, workspaceId);
      const now = new Date().toISOString();
      const cred: WorkspaceCredential = {
        ...input,
        createdAt: now,
        id: nextId(creds),
        type: 'file',
        updatedAt: now,
      };
      await saveCreds(ctx, workspaceId, [...creds, cred]);
      return publicCred(cred, true);
    }),

  createKV: credsProcedure
    .input(
      z.object({
        description: z.string().optional(),
        key: z.string().min(1).max(100),
        name: z.string().min(1).max(255),
        type: z.enum(['kv-env', 'kv-header']),
        values: z.record(z.string()),
        workspaceId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workspaceId = resolveWorkspaceId(ctx, input);
      await assertWorkspaceOwner(ctx, workspaceId);
      const creds = await getCreds(ctx, workspaceId);
      const now = new Date().toISOString();
      const cred: WorkspaceCredential = {
        ...input,
        createdAt: now,
        id: nextId(creds),
        updatedAt: now,
      };
      await saveCreds(ctx, workspaceId, [...creds, cred]);
      return publicCred(cred, true);
    }),

  createOAuth: credsProcedure
    .input(
      z.object({
        description: z.string().optional(),
        key: z.string().min(1).max(100),
        name: z.string().min(1).max(255),
        oauthConnectionId: z.number(),
        workspaceId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workspaceId = resolveWorkspaceId(ctx, input);
      await assertWorkspaceOwner(ctx, workspaceId);
      const creds = await getCreds(ctx, workspaceId);
      const now = new Date().toISOString();
      const cred: WorkspaceCredential = {
        ...input,
        createdAt: now,
        id: nextId(creds),
        type: 'oauth',
        updatedAt: now,
      };
      await saveCreds(ctx, workspaceId, [...creds, cred]);
      return publicCred(cred, true);
    }),

  delete: credsProcedure
    .input(z.object({ id: z.number(), workspaceId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const workspaceId = resolveWorkspaceId(ctx, input);
      await assertWorkspaceOwner(ctx, workspaceId);
      await saveCreds(
        ctx,
        workspaceId,
        (await getCreds(ctx, workspaceId)).filter((cred) => cred.id !== input.id),
      );
      return { success: true };
    }),

  deleteByKey: credsProcedure
    .input(z.object({ key: z.string(), workspaceId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const workspaceId = resolveWorkspaceId(ctx, input);
      await assertWorkspaceOwner(ctx, workspaceId);
      await saveCreds(
        ctx,
        workspaceId,
        (await getCreds(ctx, workspaceId)).filter((cred) => cred.key !== input.key),
      );
      return { success: true };
    }),

  get: credsProcedure
    .input(
      z.object({
        decrypt: z.boolean().optional(),
        id: z.number(),
        workspaceId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const workspaceId = resolveWorkspaceId(ctx, input);
      await assertWorkspaceMember(ctx, workspaceId);
      const cred = (await getCreds(ctx, workspaceId)).find((item) => item.id === input.id);
      if (!cred) throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' });
      return publicCred(cred, input.decrypt);
    }),

  getByKey: credsProcedure
    .input(
      z.object({
        decrypt: z.boolean().optional(),
        key: z.string(),
        workspaceId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const workspaceId = resolveWorkspaceId(ctx, input);
      await assertWorkspaceMember(ctx, workspaceId);
      const cred = (await getCreds(ctx, workspaceId)).find((item) => item.key === input.key);
      if (!cred) throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' });
      return publicCred(cred, input.decrypt);
    }),

  getSkillCredStatus: credsProcedure
    .input(z.object({ skillIdentifier: z.string(), workspaceId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const workspaceId = resolveWorkspaceId(ctx, input);
      await assertWorkspaceMember(ctx, workspaceId);
      return (await getCreds(ctx, workspaceId)).map((cred) => ({
        key: cred.key,
        name: cred.name,
        ready: true,
        skillIdentifier: input.skillIdentifier,
      }));
    }),

  inject: credsProcedure
    .input(
      z.object({
        keys: z.array(z.string()),
        sandbox: z.boolean().optional(),
        topicId: z.string(),
        userId: z.string().optional(),
        workspaceId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workspaceId = resolveWorkspaceId(ctx, input);
      await assertWorkspaceMember(ctx, workspaceId);
      const creds = await getCreds(ctx, workspaceId);
      const found = creds.filter((cred) => input.keys.includes(cred.key));
      return {
        credentials: found.map((cred) => publicCred(cred, true)),
        notFound: input.keys.filter((key) => !found.some((cred) => cred.key === key)),
        success: true,
      };
    }),

  injectForSkill: credsProcedure
    .input(
      z.object({
        sandbox: z.boolean().optional(),
        skillIdentifier: z.string(),
        workspaceId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workspaceId = resolveWorkspaceId(ctx, input);
      await assertWorkspaceMember(ctx, workspaceId);
      return {
        credentials: (await getCreds(ctx, workspaceId)).map((cred) => publicCred(cred, true)),
        missing: [],
        success: true,
      };
    }),

  list: credsProcedure.input(workspaceInput).query(async ({ ctx, input }) => {
    const workspaceId = resolveWorkspaceId(ctx, input);
    await assertWorkspaceMember(ctx, workspaceId);
    return { data: (await getCreds(ctx, workspaceId)).map((cred) => publicCred(cred, false)) };
  }),

  listOAuthConnections: credsProcedure.query(() => ({ connections: [] })),

  update: credsProcedure
    .input(
      z.object({
        description: z.string().optional(),
        id: z.number(),
        name: z.string().optional(),
        values: z.record(z.string()).optional(),
        workspaceId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workspaceId = resolveWorkspaceId(ctx, input);
      await assertWorkspaceOwner(ctx, workspaceId);
      const creds = await getCreds(ctx, workspaceId);
      const now = new Date().toISOString();
      const updated = creds.map((cred) =>
        cred.id === input.id
          ? {
              ...cred,
              description: input.description ?? cred.description,
              name: input.name ?? cred.name,
              updatedAt: now,
              values: input.values ?? cred.values,
            }
          : cred,
      );
      const updatedCred = updated.find((cred) => cred.id === input.id);
      if (!updatedCred) throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' });

      await saveCreds(ctx, workspaceId, updated);
      return publicCred(updatedCred, true);
    }),

  uploadFile: credsProcedure
    .input(z.object({ file: z.string(), fileName: z.string().min(1), fileType: z.string().min(1) }))
    .mutation(async ({ input }) => ({
      fileHashId: createHash('sha256')
        .update(`${input.fileName}:${input.fileType}:${input.file}`)
        .digest('hex'),
    })),
});
