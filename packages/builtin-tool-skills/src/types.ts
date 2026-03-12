export const SkillsIdentifier = 'lobe-skills';

export const SkillsApiName = {
  execScript: 'execScript',
  exportFile: 'exportFile',
  readReference: 'readReference',
  runSkill: 'runSkill',
};

export interface RunSkillParams {
  name: string;
}

export interface RunSkillState {
  description?: string;
  hasResources: boolean;
  id: string;
  name: string;
}

/**
 * Activated skill info passed to execScript
 */
export interface ExecScriptActivatedSkill {
  description?: string;
  id: string;
  name: string;
}

export interface ExecScriptParams {
  /**
   * All activated skills from stepContext
   * Server will resolve zipUrls for all skills
   */
  activatedSkills?: ExecScriptActivatedSkill[];
  command: string;
  /**
   * @deprecated Use activatedSkills instead. Kept for backward compatibility.
   */
  config?: {
    description?: string;
    id?: string;
    name?: string;
  };
  description: string;
}

export interface ExecScriptState {
  command: string;
  exitCode: number;
  success: boolean;
}

export interface RunCommandOptions {
  command: string;
  timeout?: number;
}

export interface CommandResult {
  exitCode: number;
  output: string;
  stderr?: string;
  success: boolean;
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
