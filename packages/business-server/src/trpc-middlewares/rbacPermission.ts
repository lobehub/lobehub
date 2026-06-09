import { trpc } from '@/libs/trpc/lambda/init';

/**
 * No-op stub for OSS builds. Cloud overrides this entire module via tsconfig
 * path priority and provides the real workspace-RBAC-aware implementations
 * (see `src/business/server/trpc-middlewares/rbacPermission.ts` in the cloud
 * repo). In OSS there is no workspace concept worth gating, so every gate
 * passes through.
 *
 * Keep the export shape identical to the cloud version so router code that
 * imports from `@/business/server/trpc-middlewares/rbacPermission` compiles
 * and runs in both environments without conditional imports.
 */
export const withRbacPermission = (_code: string) => trpc.middleware(async (opts) => opts.next());

export const withAnyRbacPermission = (_codes: string[]) =>
  trpc.middleware(async (opts) => opts.next());

export const withAllRbacPermissions = (_codes: string[]) =>
  trpc.middleware(async (opts) => opts.next());

/**
 * Sugar for the "member-or-owner" gate — in cloud this fans the action code
 * out into the `:all | :owner` scope pair so a member with the `:owner` grant
 * passes alongside an owner with the `:all` grant. OSS no-op.
 */
export const withScopedPermission = (_action: string) =>
  trpc.middleware(async (opts) => opts.next());
