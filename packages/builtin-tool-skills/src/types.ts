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

export interface ExecScriptParams {
  command: string;
  /**
   * Skill configuration context
   * Used by server to locate skill resources (zipUrl will be resolved server-side)
   */
  config?: {
    /**
     * Current skill's description
     */
    description?: string;
    /**
     * Current skill's ID
     */
    id?: string;
    /**
     * Current skill's name
     */
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
