import { hasApiKeyScope, isFullAccessApiKey } from '@lobechat/const/apiKeyScope';
import type { UserSettings } from '@lobechat/types';
import {
  PERSONAL_SYSTEM_AGENT_KEYS,
  UserPreferenceSchema,
  UserSettingsSchema,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { RbacModel } from '@/database/models/rbac';
import { router } from '@/libs/trpc/lambda';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { userProcedure } from './procedures';

const OWNER_SETTING_KEYS = ['defaultAgent', 'image', 'memory', 'systemAgent', 'tts'] as const;

const MEMBER_SETTING_KEYS = ['tool'] as const;

const WORKSPACE_UPDATE_PERMISSION = 'workspace:update:all';

const WORKSPACE_CONTENT_PERMISSIONS = ['agent:update:all', 'agent:update:owner'] as const;

const hasOwnerSettingChange = (input: Partial<UserSettings>) =>
  OWNER_SETTING_KEYS.some((key) => input[key] !== undefined);

const hasMemberSettingChange = (input: Partial<UserSettings>) =>
  MEMBER_SETTING_KEYS.some((key) => input[key] !== undefined);

export const settingsRouter = router({
  resetSettings: userProcedure.mutation(async ({ ctx }) => {
    return ctx.userModel.deleteSetting();
  }),
  updatePreference: userProcedure.input(UserPreferenceSchema).mutation(async ({ ctx, input }) => {
    return ctx.userModel.updatePreference(input);
  }),
  /**
   * Personal chat-assist preferences (follow-up chips, input completion). They
   * act on the caller's own chat surface, so — unlike the rest of
   * `systemAgent` — no workspace permission gates them, and they patch only
   * their own entry instead of rewriting the whole column.
   */
  updatePersonalSystemAgent: userProcedure
    .input(
      z
        .object({
          key: z.enum(PERSONAL_SYSTEM_AGENT_KEYS),
          value: z
            .object({
              enabled: z.boolean().optional(),
              model: z.string().trim().min(1).max(256).optional(),
              provider: z.string().trim().min(1).max(256).optional(),
            })
            .strict(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.userModel.mergeSystemAgentItemSetting(input.key, input.value);
    }),
  updateSettings: userProcedure.input(UserSettingsSchema).mutation(async ({ ctx, input }) => {
    const { keyVaults, ...res } = input as Partial<UserSettings>;
    // presence, not truthiness: `keyVaults: null` is an explicit credential clear
    const hasKeyVaultsUpdate = 'keyVaults' in (input as Partial<UserSettings>);

    // credential-bearing settings: `keyVaults` holds provider/tool credentials,
    // `market` holds Marketplace OAuth access/refresh tokens. A restricted key
    // needs `model:write` on top of the namespace's `user:write` to touch (or
    // clear) either; full-access keys pass through.
    const touchedCredentialFields = ['keyVaults', 'market'].filter(
      (field) => field in (input as Partial<UserSettings>),
    );
    if (
      touchedCredentialFields.length > 0 &&
      ctx.apiKeyScopes !== undefined &&
      !isFullAccessApiKey(ctx.apiKeyScopes) &&
      !hasApiKeyScope(ctx.apiKeyScopes, 'model:write')
    ) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `This API key cannot update credential settings ('${touchedCredentialFields.join("', '")}'): missing required scope 'model:write'.`,
      });
    }

    if (ctx.workspaceId && (hasOwnerSettingChange(res) || hasMemberSettingChange(res))) {
      const rbac = new RbacModel(ctx.serverDB, ctx.userId);
      const allowed = hasOwnerSettingChange(res)
        ? await rbac.hasPermission(WORKSPACE_UPDATE_PERMISSION, {
            workspaceId: ctx.workspaceId,
          })
        : await rbac.hasAnyPermission([...WORKSPACE_CONTENT_PERMISSIONS], {
            workspaceId: ctx.workspaceId,
          });

      if (!allowed) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to perform this action.',
        });
      }
    }

    // Encrypt keyVaults; only touch the column when the caller sent the field,
    // so a settings update without `keyVaults` no longer clears stored creds
    const nextValue: Record<string, unknown> = { ...res };

    if (hasKeyVaultsUpdate) {
      let encryptedKeyVaults: string | null = null;

      if (keyVaults) {
        // TODO: better to add a validation
        const data = JSON.stringify(keyVaults);
        const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

        encryptedKeyVaults = await gateKeeper.encrypt(data);
      }

      nextValue.keyVaults = encryptedKeyVaults;
    }

    return ctx.userModel.updateSetting(nextValue);
  }),
  updateToolIntervention: userProcedure
    .input(
      z
        .object({
          appendAllowList: z.array(z.string().trim().min(1).max(256)).max(64).optional(),
          approvalMode: z.enum(['auto-run', 'allow-list', 'manual']).optional(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      // `tool` is a member-scope workspace setting — same RBAC gate as updateSettings
      if (ctx.workspaceId) {
        const rbac = new RbacModel(ctx.serverDB, ctx.userId);
        const allowed = await rbac.hasAnyPermission([...WORKSPACE_CONTENT_PERMISSIONS], {
          workspaceId: ctx.workspaceId,
        });

        if (!allowed) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have permission to perform this action.',
          });
        }
      }

      // Server-side merge on the `tool` column: each browser tab fetches user
      // state once and can hold hours-stale settings, so a whole-column `tool`
      // replace built from client memory clobbers changes made from other tabs
      // (e.g. reverts approvalMode). The model merges atomically in one SQL
      // statement, so even two concurrent calls cannot drop each other's change.
      return ctx.userModel.mergeToolInterventionSetting(input);
    }),
  updateToolChannels: userProcedure
    .input(
      z
        .object({
          crawlerImpls: z.array(z.string().trim().min(1).max(64)).max(32).optional(),
          searchProviders: z.array(z.string().trim().min(1).max(64)).max(32).optional(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      // `tool` is a member-scope workspace setting — same RBAC gate as updateSettings
      if (ctx.workspaceId) {
        const rbac = new RbacModel(ctx.serverDB, ctx.userId);
        const allowed = await rbac.hasAnyPermission([...WORKSPACE_CONTENT_PERMISSIONS], {
          workspaceId: ctx.workspaceId,
        });

        if (!allowed) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have permission to perform this action.',
          });
        }
      }

      // Patch only the channel keys atomically — a whole-column `tool` write
      // built from a stale tab snapshot would revert other tool settings.
      return ctx.userModel.replaceToolChannelsSetting(input);
    }),
  updateUninstalledBuiltinTools: userProcedure
    .input(
      z
        .object({
          uninstalledBuiltinTools: z.array(z.string().trim().min(1).max(256)).max(256),
          // The client pins the scope it computed the list for. Deriving the slot
          // from the request's dynamic workspace header instead would let a
          // workspace switch during the action write scope A's list into scope B.
          workspaceId: z.string().trim().min(1).max(128).nullable(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      // `tool` is a member-scope workspace setting — same RBAC gate as
      // updateSettings, checked against the TARGET workspace slot
      if (input.workspaceId) {
        const rbac = new RbacModel(ctx.serverDB, ctx.userId);
        const allowed = await rbac.hasAnyPermission([...WORKSPACE_CONTENT_PERMISSIONS], {
          workspaceId: input.workspaceId,
        });

        if (!allowed) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have permission to perform this action.',
          });
        }
      }

      // The model patches only the pinned scope's slot atomically — a
      // whole-column write built from a client snapshot would race with
      // concurrent tool-column writers (e.g. an approvalMode change) and could
      // revert them.
      return ctx.userModel.replaceUninstalledBuiltinToolsSetting({
        uninstalledBuiltinTools: input.uninstalledBuiltinTools,
        workspaceId: input.workspaceId,
      });
    }),
});
