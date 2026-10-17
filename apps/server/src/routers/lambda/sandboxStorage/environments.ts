import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { rethrowDuplicateEnvironmentName, rethrowEnvironmentInUse } from './constraintErrors';
import {
  createDerivedInstance,
  deleteInstanceSnapshot,
  inEnvironmentTransaction,
} from './instanceOperations';
import { environmentProcedure, instanceProcedure } from './procedures';
import { idSchema, nameSchema, relativePathSchema, visibilitySchema } from './schemas';

/**
 * The hosts a checkout may name.
 *
 * An allowlist rather than an SSRF check on the resolved address, because the
 * clone does not happen here: the stored specification is handed to the
 * execution plane, which resolves and fetches it from its own network, so no
 * validation at this layer can speak for what that resolution will return.
 * Naming the hosts is the part this layer can be sure of — and every producer
 * already names exactly one, since a source is chosen through the GitHub
 * repository picker and the UI parses the URL back assuming that host.
 */
const ALLOWED_SOURCE_HOSTS = new Set(['github.com', 'www.github.com']);

/**
 * Where source material comes from. Only `git` for now, and only over HTTPS:
 * the other transports authenticate with a key, and a specification that
 * carries no credentials cannot present one. Private repositories are a
 * separate problem, not a URL scheme.
 *
 * The host is checked because this schema guards an RPC, not the picker: an
 * entitled caller reaching it directly could otherwise store any URL, and the
 * build would then make the execution plane fetch it — an internal address
 * included.
 */
const environmentSourceSchema = z.object({
  kind: z.literal('git'),
  /** Where the checkout lands, relative to the instance's own directory. */
  path: relativePathSchema.optional(),
  ref: z.string().trim().min(1).max(255).optional(),
  url: z
    .string()
    .url()
    .refine(
      (value) => {
        let parsed;
        try {
          parsed = new URL(value);
        } catch {
          return false;
        }

        return parsed.protocol === 'https:' && ALLOWED_SOURCE_HOSTS.has(parsed.hostname);
      },
      { message: 'Only https:// github.com git URLs are supported' },
    ),
});

/**
 * Non-secret values only. Enforced by shape as far as a shape can: the name has
 * to look like an environment variable, and the rest is said plainly in the UI
 * and in the type. A field that stores what the user types cannot tell a region
 * from a token, which is why secrets are resolved at use time instead.
 */
const environmentEnvSchema = z.record(
  z
    .string()
    .max(128)
    .regex(/^[A-Z_]\w*$/i, 'Must be a valid environment variable name'),
  z.string().max(4096),
);

const configurationSchema = z.object({
  bootstrapCommand: z.string().max(8000).optional(),
  env: environmentEnvSchema.optional(),
  excludePaths: z.array(relativePathSchema).max(64).optional(),
  internetAccess: z.boolean().optional(),
  // Which form the product shows. Accepted here so it is stored rather than
  // stripped by the parse; it never travels on to the execution plane.
  kind: z.enum(['files', 'code']).optional(),
  maintenanceCommand: z.string().max(8000).optional(),
  // One repository per environment. The wire format stays a list because the
  // execution plane checks out an array of sources, but an environment that
  // builds from two repositories has no single working directory to hand a
  // conversation — and the picker that fills this offers exactly one.
  sources: z.array(environmentSourceSchema).max(1).optional(),
});

export const environmentsProcedures = {
  /**
   * An environment, together with its default instance.
   *
   * The person creating an environment has not started any work yet, so there
   * is nothing to ask them about where it should happen: the instance is
   * created here, with the same derived directory a new copy gets, and every
   * creation path ends with one. It is returned unbuilt — building it
   * cold-starts a sandbox, so the client fires `startInstanceBuild` next, the
   * same split as for any other new instance.
   *
   * Both rows are written in one transaction, so a failure to create the
   * instance leaves no environment behind either: the caller sees the failure
   * and retries, instead of holding an environment that silently skipped the
   * step.
   *
   * Asked for, not assumed. A client from before this follows the call with
   * its own create-instance dialog, and an instance made here as well would
   * leave it with two — the unasked one being the default, which cannot be
   * removed on its own. Such a client gets the environment alone, as it always
   * did, and its first instance becomes the default.
   */
  createEnvironment: instanceProcedure
    .input(
      z.object({
        configuration: configurationSchema.optional(),
        description: z.string().max(2000).optional(),
        name: nameSchema,
        visibility: visibilitySchema.optional(),
        withDefaultInstance: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input: { withDefaultInstance, ...input } }) =>
      inEnvironmentTransaction(ctx, async ({ environmentModel, instanceModel }) => {
        const environment = await environmentModel
          .create(input)
          .catch(rethrowDuplicateEnvironmentName);
        if (!withDefaultInstance) return { ...environment, defaultInstance: undefined };

        const defaultInstance = await createDerivedInstance(
          instanceModel,
          ctx.claim.key,
          environment,
        );

        return { ...environment, defaultInstance };
      }),
    ),
  /** Specifications only. Nothing here needs a sandbox session to answer. */
  listEnvironments: environmentProcedure
    .input(z.object({ visibility: visibilitySchema.optional() }).optional())
    .query(async ({ ctx, input }) => ({
      environments: await ctx.environmentModel.query(input?.visibility),
    })),
  /**
   * Edits the specification. Existing instances keep the one they were created
   * with — a change here shapes what the NEXT instance is built from and
   * touches nothing a conversation has already installed or produced.
   */
  updateEnvironment: environmentProcedure
    .input(
      z.object({
        configuration: configurationSchema.optional(),
        description: z.string().max(2000).optional(),
        id: idSchema,
        name: nameSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...changes } = input;
      const updated = await ctx.environmentModel
        .update(id, changes)
        .catch(rethrowDuplicateEnvironmentName);
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });

      return updated;
    }),
  /**
   * Only the label. The directory does not move: the built state sits in it,
   * and the execution plane has no rename that carries one to the other.
   */
  /**
   * Publishing an environment to the workspace, or taking it back.
   *
   * Its own mutation rather than a field on `updateEnvironment`, because the
   * two are not the same kind of edit: renaming is between you and your own
   * row, while this one decides who else can run in what this environment
   * built — and the client asks for confirmation before sending it.
   */
  setEnvironmentVisibility: environmentProcedure
    .input(z.object({ id: idSchema, visibility: visibilitySchema }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.environmentModel.setVisibility(input.id, input.visibility);
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });

      return updated;
    }),
  /**
   * Refused while copies other than the default still reference it — those go
   * first.
   *
   * The default instance goes with the environment: it cannot be removed on
   * its own, so for an environment with only that one left, deleting the
   * environment is how it is deleted.
   *
   * Both rows go in one transaction, and the snapshot is dropped last, inside
   * it. Anything that refuses — a project still bound to the environment, an
   * instance created meanwhile, a run still holding the snapshot — rolls the
   * rows back with the snapshot untouched, so a refused delete costs nothing.
   * The one gap left is a commit that fails after the snapshot is gone, which
   * leaves rows with nothing built behind them. What was lost is what this
   * call was asked to delete, and the call reports its failure, so deleting
   * again finishes the job. The other order is the one with no way back: rows
   * gone and a snapshot nobody can see, name, or reclaim.
   */
  removeEnvironment: instanceProcedure
    .input(z.object({ id: idSchema }))
    .mutation(async ({ ctx, input }) => {
      // Ownership before anything reaches the execution plane: a member who
      // can see a published environment must not get its snapshot deleted on
      // the way to being refused the row.
      const environment = await ctx.environmentModel.findOwnedById(input.id);
      if (!environment)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });

      const instances = await ctx.instanceModel.query({ environmentId: environment.id });
      if (instances.length > 1) {
        throw new TRPCError({ code: 'CONFLICT', message: 'ENVIRONMENT_HAS_INSTANCES' });
      }

      const [onlyInstance] = instances;
      // Only a sandbox instance has a snapshot this router can drop; any other
      // kind keeps referencing the environment and the delete below says so.
      const defaultInstance = onlyInstance?.kind === 'sandbox' ? onlyInstance : undefined;

      return inEnvironmentTransaction(ctx, async ({ environmentModel, instanceModel }) => {
        if (defaultInstance) {
          await instanceModel.delete(defaultInstance.id).catch(rethrowEnvironmentInUse);
        }

        const removed = await environmentModel.delete(input.id).catch(rethrowEnvironmentInUse);
        if (!removed) throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });

        if (defaultInstance) await deleteInstanceSnapshot(ctx.client, defaultInstance.id);

        return removed;
      });
    }),
};
