export const SkillsIdentifier = 'lobe-skills';

export const SkillsApiName = {
  execScript: 'execScript',
  exportFile: 'exportFile',
  readReference: 'readReference',
  runCommand: 'runCommand',
  activateSkill: 'activateSkill',
};

export interface ActivateSkillParams {
  name: string;
}

export type ActivateSkillSource = 'agent' | 'builtin' | 'device' | 'project' | 'user';

export interface ActivateSkillState {
  description?: string;
  hasResources: boolean;
  id: string;
  name: string;
  /** Skill origin — drives the inspector label (e.g. "Activate Agent Skill"). */
  source?: ActivateSkillSource;
  /** Friendly title for UI display; falls back to `name` when unset. */
  title?: string;
}

/**
 * Activated skill info passed to execScript
 */
export interface ExecScriptActivatedSkill {
  description?: string;
  /** DB skill id; absent for filesystem/builtin activations — match by `name`. */
  id?: string;
  name: string;
}

export interface ExecScriptParams {
  /**
   * All activated skills from stepContext
   * Server will resolve zipUrls for all skills
   */
  activatedSkills?: ExecScriptActivatedSkill[];
  command: string;
  description: string;
}

export interface ExecScriptState {
  command: string;
  executionEnv?: 'device' | 'sandbox';
  /**
   * Undefined means the command was still running when the observation window
   * elapsed — mirrors `CommandResult.exitCode`.
   */
  exitCode?: number;
  outputFiles?: CommandResult['outputFiles'];
  /**
   * Shell handle for a still-running command, pollable via
   * `local-system.getCommandOutput`.
   */
  shellId?: string;
  success: boolean;
}

export interface RunCommandOptions {
  command: string;
  timeout?: number;
}

export interface CommandResult {
  /**
   * Where the command actually ran. Flows into the tool call's plugin state so
   * execution-target degradation is observable in the product UI.
   */
  executionEnv?: 'device' | 'sandbox';
  /**
   * Undefined means the command was still running when the observation window
   * elapsed — the formatter reports it as still running instead of completed.
   */
  exitCode?: number;
  output: string;
  /**
   * Saved-output file handles reported by the shell when stdout/stderr exceed
   * the inline preview (device runs save the full stream to disk) — the only
   * retrieval path for output the preview truncated.
   */
  outputFiles?: {
    stderr?: { path: string; size?: number; truncated?: boolean };
    stdout?: { path: string; size?: number; truncated?: boolean };
  };
  /**
   * Shell handle for a still-running command, pollable via
   * `local-system.getCommandOutput`.
   */
  shellId?: string;
  stderr?: string;
  success: boolean;
}

export interface RunCommandParams {
  command: string;
  description?: string;
}

export interface ReadReferenceParams {
  id: string;
  path: string;
}

export interface ReadReferenceState {
  encoding: 'base64' | 'utf8';
  fileType: string;
  fullPath?: string;
  path: string;
  size: number;
}

export interface ExportFileParams {
  /**
   * The filename to use for the exported file
   */
  filename: string;
  /**
   * The path of the file in the skill execution environment to export
   */
  path: string;
}

export interface ExportFileState {
  fileId?: string;
  filename: string;
  mimeType?: string;
  size?: number;
  url?: string;
}
