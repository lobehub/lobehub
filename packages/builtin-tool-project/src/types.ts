export const ProjectIdentifier = 'builtin-project';

export const ProjectApiName = {
  addRunner: 'addRunner',
  getEnvironment: 'getEnvironment',
  listRunners: 'listRunners',
  removeRunner: 'removeRunner',
  reorderRunners: 'reorderRunners',
  switchRunner: 'switchRunner',
  updateEnvironment: 'updateEnvironment',
} as const;

export type ProjectApiNameType = (typeof ProjectApiName)[keyof typeof ProjectApiName];

/** The id the cloud sandbox takes among a project's runners. */
export const SANDBOX_RUNNER_ID = 'sandbox';

export interface ProjectToolRunner {
  /** This conversation runs here. */
  current?: boolean;
  deviceId?: string | null;
  deviceName?: string | null;
  /** A folder id, or `sandbox`. */
  id: string;
  kind: 'device' | 'sandbox';
  /** Absent when presence could not be read. */
  online?: boolean;
  path?: string;
  /** This conversation moves here when its next turn starts. */
  pending?: boolean;
  platform?: string | null;
  /** False for a folder a run cannot start in yet (its device never confirmed it). */
  runnable?: boolean;
}

export interface ProjectToolDevice {
  deviceId: string;
  name: string;
  online: boolean;
  platform?: string | null;
}

export interface ProjectToolRepository {
  folder?: string;
  ref?: string;
  setupCommand?: string;
  url: string;
}

export interface ProjectToolEnvironment {
  bootstrapCommand?: string;
  /** Names only: values are never shown to the agent. */
  envNames: string[];
  notes?: string;
  repositories: ProjectToolRepository[];
}

export interface AddRunnerParams {
  deviceId: string;
  path: string;
}

export interface RemoveRunnerParams {
  runnerId: string;
}

export interface ReorderRunnersParams {
  runnerIds: string[];
}

export interface SwitchRunnerParams {
  runnerId: string;
}

export interface UpdateEnvironmentParams {
  addRepositories?: { ref?: string; url: string }[];
  notes?: string;
  removeRepositories?: string[];
  setupCommand?: string;
}

/** Data access the runtime needs; the server implements it on the project's own models. */
export interface ProjectToolService {
  addRunner: (params: AddRunnerParams) => Promise<ProjectToolRunner>;
  getEnvironment: () => Promise<ProjectToolEnvironment>;
  listRunners: () => Promise<{ devices: ProjectToolDevice[]; runners: ProjectToolRunner[] }>;
  removeRunner: (params: RemoveRunnerParams) => Promise<void>;
  reorderRunners: (params: ReorderRunnersParams) => Promise<ProjectToolRunner[]>;
  /** Moves this conversation from its next turn; returns the runners with the target marked pending. */
  switchRunner: (params: SwitchRunnerParams) => Promise<ProjectToolRunner[]>;
  updateEnvironment: (params: UpdateEnvironmentParams) => Promise<ProjectToolEnvironment>;
}

export interface ProjectToolState {
  environment?: ProjectToolEnvironment;
  runners?: ProjectToolRunner[];
}
