import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  ImportFromMarketParams,
  ImportSkillParams,
  InspectSkillParams,
  InspectSkillState,
  MarketSkillItem,
  SearchSkillParams,
  SkillEnvVarUsage,
  SkillPackageFile,
} from '../types';
import { scanSkillFiles } from './scanSkillFiles';

export interface SkillImportServiceResult {
  skill: { id: string; name: string };
  status: 'created' | 'updated' | 'unchanged';
}

export interface SkillStoreRuntimeService {
  /**
   * The text files of a market skill package — `SKILL.md` body included — so
   * `inspectSkill` can read what the skill needs before it is installed.
   */
  getMarketSkillFiles?: (
    identifier: string,
  ) => Promise<{ files: SkillPackageFile[]; name?: string }>;
  importFromGitHub: (gitUrl: string) => Promise<SkillImportServiceResult>;
  importFromMarket?: (identifier: string) => Promise<SkillImportServiceResult>;
  importFromUrl: (url: string) => Promise<SkillImportServiceResult>;
  importFromZipUrl: (url: string) => Promise<SkillImportServiceResult>;
  onSkillImported?: () => Promise<void>;
  searchSkill?: (
    params: SearchSkillParams,
  ) => Promise<{ items: MarketSkillItem[]; page: number; pageSize: number; total: number }>;
}

export interface SkillStoreExecutionRuntimeOptions {
  service: SkillStoreRuntimeService;
}

/**
 * Descriptions come from each skill's own SKILL.md front-matter, unreviewed.
 * One claimed "no API key needed" while its script required a vendor key and
 * uploaded the user's images to that vendor's API.
 */
const SEARCH_RESULT_NOTE =
  "Descriptions are written by each skill's author and are not verified. Before recommending or installing a skill, call inspectSkill to see the credentials it needs and the hosts its scripts contact.";

const formatEnvVars = (vars: SkillEnvVarUsage[]) =>
  vars.map(({ name, files }) => `  - ${name} (${files.join(', ')})`).join('\n');

/** Settings that point the scripts somewhere else: a base URL, endpoint or host. */
const DESTINATION_SETTING = /(?:URL|URI|ENDPOINT|HOST|BASE)$/;

/** Shown on every result: a list of findings can look complete when it is not. */
const STATIC_SCAN_CAVEAT =
  'This is a static check of the files: credential names and URLs a script builds at run time are not detected, so these lists can be incomplete. Do not present them as exhaustive.';

const formatRequirements = (state: InspectSkillState): string => {
  const { credentials, endpoints, scripts, settings } = state;
  const label = state.name ? `"${state.name}" (${state.identifier})` : `"${state.identifier}"`;
  const scriptSummary =
    scripts.length > 0
      ? `SKILL.md and ${scripts.length} script(s): ${scripts.join(', ')}`
      : 'SKILL.md; it ships no scripts';

  const destinationSettings = settings
    .map(({ name }) => name)
    .filter((name) => DESTINATION_SETTING.test(name));
  const needsSetupOrSendsData =
    credentials.length > 0 || endpoints.length > 0 || destinationSettings.length > 0;
  const hostList = endpoints.map(({ host, files }) => `  - ${host} (${files.join(', ')})`);

  return [
    `Checked the files of ${label}: ${scriptSummary}. These findings come from the files, not the description; where the description says otherwise about API keys, setup or where data goes, the files are right.`,
    credentials.length > 0
      ? `Credential environment variables it reads or tells the user to set. The user has to supply their own; scripts often accept one of several alternatives (a specific key falling back to a general one), so not every name is necessarily required:\n${formatEnvVars(credentials)}`
      : 'Credentials: none found.',
    settings.length > 0 &&
      `Other environment variables its scripts read:\n${formatEnvVars(settings)}`,
    endpoints.length > 0
      ? `Network hosts written in its scripts — data the scripts process (files, images, text) can be sent there:\n${hostList.join('\n')}`
      : 'Network hosts: none written in its scripts.',
    destinationSettings.length > 0 &&
      `Where the scripts send data can also be changed through ${destinationSettings.join(', ')}.`,
    needsSetupOrSendsData &&
      'Tell the user which credentials it needs and where it sends data before installing, and do not describe the skill as needing no setup or keeping data local.',
    STATIC_SCAN_CAVEAT,
  ]
    .filter(Boolean)
    .join('\n\n');
};

export class SkillStoreExecutionRuntime {
  private service: SkillStoreRuntimeService;

  constructor(options: SkillStoreExecutionRuntimeOptions) {
    this.service = options.service;
  }

  /**
   * Notify the host that a skill was imported so it can refresh client state
   * (e.g. the agent skills list). Invoked from the executor's `onAfterCall`
   * lifecycle hook, which fires on `tool_end` regardless of whether the import
   * actually ran client- or server-side — covering the server-runtime path the
   * inline service callback can't reach.
   */
  notifyImported(): Promise<void> {
    return this.service.onSkillImported?.() ?? Promise.resolve();
  }

  async importSkill(args: ImportSkillParams): Promise<BuiltinServerRuntimeOutput> {
    const { url, type } = args;

    // Determine import method based on URL and type
    let isGitHub = false;
    try {
      const hostname = new URL(url).hostname;
      isGitHub = hostname === 'github.com' || hostname.endsWith('.github.com');
    } catch {
      // invalid URL — fall through to importFromUrl
    }

    try {
      let result: SkillImportServiceResult;

      if (isGitHub && type === 'url') {
        result = await this.service.importFromGitHub(url);
      } else if (type === 'zip') {
        result = await this.service.importFromZipUrl(url);
      } else {
        result = await this.service.importFromUrl(url);
      }

      // Refresh the skills list for the direct/local client invoke path
      // (`invokeBuiltinTool`), which never dispatches the executor's
      // `onAfterCall`. The gateway path covers itself via `onAfterCall` and
      // routes import through the server runtime, so this never double-fires.
      await this.service.onSkillImported?.();

      return {
        content: `Skill "${result.skill.name}" ${result.status} successfully.`,
        state: {
          name: result.skill.name,
          skillId: result.skill.id,
          status: result.status,
          success: true,
        },
        success: true,
      };
    } catch (e) {
      return {
        content: `Failed to import skill: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async searchSkill(args: SearchSkillParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.service.searchSkill) {
      return {
        content: 'Market skill search is not available in this environment.',
        success: false,
      };
    }

    try {
      const result = await this.service.searchSkill(args);

      if (result.items.length === 0) {
        return {
          content: args.q
            ? `No skills found matching "${args.q}"`
            : 'No skills found in the market',
          state: result,
          success: true,
        };
      }

      // Format results as a readable list
      const skillsList = result.items
        .map(
          (skill, index) =>
            `${index + 1}. **${skill.name}** (${skill.identifier})\n   ${skill.description}${skill.summary ? `\n   Summary: ${skill.summary}` : ''}${skill.repository ? `\n   Repository: ${skill.repository}` : ''}${skill.installCount ? `\n   Installs: ${skill.installCount}` : ''}`,
        )
        .join('\n\n');

      return {
        content: `Found ${result.total} skills (page ${result.page}/${Math.ceil(result.total / result.pageSize)}):\n\n${skillsList}\n\n${SEARCH_RESULT_NOTE}`,
        state: result,
        success: true,
      };
    } catch (e) {
      return {
        content: `Failed to search skills: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async inspectSkill(args: InspectSkillParams): Promise<BuiltinServerRuntimeOutput> {
    const { identifier } = args;

    if (!this.service.getMarketSkillFiles) {
      return {
        content: 'Market skill inspection is not available in this environment.',
        success: false,
      };
    }

    try {
      const { files, name } = await this.service.getMarketSkillFiles(identifier);
      const state: InspectSkillState = { identifier, name, ...scanSkillFiles(files) };

      return { content: formatRequirements(state), state, success: true };
    } catch (e) {
      return {
        content: `Failed to inspect skill "${identifier}": ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async importFromMarket(args: ImportFromMarketParams): Promise<BuiltinServerRuntimeOutput> {
    const { identifier } = args;

    if (!this.service.importFromMarket) {
      return {
        content: 'Market skill import is not available in this environment.',
        success: false,
      };
    }

    try {
      const result = await this.service.importFromMarket(identifier);

      // See importSkill: refresh for the direct/local client invoke path.
      await this.service.onSkillImported?.();

      return {
        content: `Skill "${result.skill.name}" ${result.status} successfully from market.`,
        state: {
          name: result.skill.name,
          skillId: result.skill.id,
          status: result.status,
          success: true,
        },
        success: true,
      };
    } catch (e) {
      return {
        content: `Failed to import skill from market: ${(e as Error).message}`,
        success: false,
      };
    }
  }
}
