export const SkillsIdentifier = 'lobe-skills';

export const SkillsApiName = {
  execScript: 'execScript',
  exportFile: 'exportFile',
  importSkill: 'importSkill',
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
  /**
   * Whether to run on the desktop client (for local shell access).
   * Only available on desktop. When false or omitted, runs in cloud sandbox.
   */
  runInClient?: boolean;
}

export interface ExecScriptState {
  command: string;
  exitCode: number;
  success: boolean;
}

export interface RunCommandOptions {
  command: string;
  runInClient?: boolean;
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
  encoding: 'base64' | 'utf-8';
  fileType: string;
  path: string;
  size: number;
}

export interface ImportSkillParams {
  type: 'url' | 'zip';
  url: string;
}

export interface ImportSkillState {
  name?: string;
  skillId?: string;
  status: 'created' | 'updated' | 'unchanged';
  success: boolean;
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
