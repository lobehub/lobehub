import { builtinSkillManifests } from '@lobechat/builtin-skills/manifests';
import { builtinToolIdentifiers } from '@lobechat/builtin-tools/identifiers';
import { MarketAPIError } from '@lobehub/market-sdk';
import debug from 'debug';
import pMap from 'p-map';
import { z } from 'zod';

import type { AgentSkillModel } from '@/database/models/agentSkill';
import type { MarketService } from '@/server/services/market';

import { SkillImportError } from './errors';
import type { SkillImporter } from './importer';

const log = debug('lobe-chat:service:skill-ensure');

const logEnsureFailure = (
  identifier: string,
  stage: 'lookup' | 'detail' | 'import',
  error: unknown,
) => {
  log('ensureFromMarket failed: %o', {
    identifier,
    stage,
    ...(error instanceof MarketAPIError && { status: error.status }),
    ...(error instanceof SkillImportError && { code: error.code }),
  });
};

export type EnsureMarketSkillResult =
  | { identifier: string; status: 'installed' | 'skipped' | 'notSkill' }
  | {
      identifier: string;
      message?: string;
      reason: 'conflict' | 'download' | 'unavailable';
      status: 'failed';
    };

export const ensureMarketSkillsInputSchema = z.object({
  identifiers: z
    .array(z.string())
    .transform((identifiers) => [...new Set(identifiers.map((id) => id.trim()).filter(Boolean))])
    .pipe(z.array(z.string()).max(50)),
});

const builtinIdentifiers = new Set([
  ...builtinToolIdentifiers,
  ...builtinSkillManifests.map((skill) => skill.identifier),
]);

interface EnsureMarketSkillsDependencies {
  marketService: Pick<MarketService, 'getSkillDetail' | 'getSkillDownloadUrl'>;
  skillImporter: Pick<SkillImporter, 'importFromUrl'>;
  skillModel: Pick<AgentSkillModel, 'findByIdentifier'>;
}

/** The scope's record for `identifier` after a failed import; a failed lookup counts as none. */
const findAfterFailedImport = async (
  identifier: string,
  skillModel: EnsureMarketSkillsDependencies['skillModel'],
) => {
  try {
    return await skillModel.findByIdentifier(identifier);
  } catch (error) {
    logEnsureFailure(identifier, 'lookup', error);
    return undefined;
  }
};

/** Ensure dependencies without replacing any skill already in the caller's scope. */
export const ensureMarketSkills = async (
  identifiers: string[],
  { marketService, skillImporter, skillModel }: EnsureMarketSkillsDependencies,
): Promise<EnsureMarketSkillResult[]> =>
  pMap(
    identifiers,
    async (identifier): Promise<EnsureMarketSkillResult> => {
      if (builtinIdentifiers.has(identifier)) return { identifier, status: 'skipped' };

      try {
        const existing = await skillModel.findByIdentifier(identifier);
        if (existing) {
          return existing.source === 'market'
            ? { identifier, status: 'installed' }
            : { identifier, reason: 'conflict', status: 'failed' };
        }
      } catch (error) {
        logEnsureFailure(identifier, 'lookup', error);
        return { identifier, reason: 'unavailable', status: 'failed' };
      }

      // Only a typed 404 from the detail endpoint proves this is not a skill.
      // Download 404s after a successful detail request remain install failures.
      try {
        await marketService.getSkillDetail(identifier);
      } catch (error) {
        logEnsureFailure(identifier, 'detail', error);
        return error instanceof MarketAPIError && error.status === 404
          ? { identifier, status: 'notSkill' }
          : { identifier, reason: 'unavailable', status: 'failed' };
      }

      try {
        await skillImporter.importFromUrl(
          { url: marketService.getSkillDownloadUrl(identifier) },
          { identifier, overwrite: false, source: 'market' },
        );
        return { identifier, status: 'installed' };
      } catch (error) {
        logEnsureFailure(identifier, 'import', error);

        // A concurrent request may have installed the same skill between our
        // lookup and the insert, which the per-scope unique constraint rejects.
        // Whatever the error was, the scope's current state decides the result.
        const raced = await findAfterFailedImport(identifier, skillModel);
        if (raced) {
          return raced.source === 'market'
            ? { identifier, status: 'installed' }
            : { identifier, reason: 'conflict', status: 'failed' };
        }

        return {
          identifier,
          reason:
            error instanceof SkillImportError && error.code === 'CONFLICT'
              ? 'conflict'
              : 'download',
          status: 'failed',
        };
      }
    },
    { concurrency: 4 },
  );
