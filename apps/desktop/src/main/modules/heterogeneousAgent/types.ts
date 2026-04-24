export interface HeterogeneousAgentImageAttachment {
  id: string;
  url: string;
}

export interface HeterogeneousAgentBuildPlan {
  args: string[];
  stdinPayload?: string;
}

export interface HeterogeneousAgentBuildPlanHelpers {
  buildClaudeStreamJsonInput: (
    prompt: string,
    imageList: HeterogeneousAgentImageAttachment[],
  ) => Promise<string>;
  resolveCliImagePaths: (imageList: HeterogeneousAgentImageAttachment[]) => Promise<string[]>;
}

export interface HeterogeneousAgentBuildPlanParams {
  args: string[];
  helpers: HeterogeneousAgentBuildPlanHelpers;
  imageList: HeterogeneousAgentImageAttachment[];
  prompt: string;
  resumeSessionId?: string;
}

export interface HeterogeneousAgentParsedOutput {
  agentSessionId?: string;
  payload: any;
}

export interface HeterogeneousAgentStreamProcessor {
  flush: () => HeterogeneousAgentParsedOutput[];
  push: (chunk: Buffer | string) => HeterogeneousAgentParsedOutput[];
}

export interface HeterogeneousAgentDriver {
  buildSpawnPlan: (
    params: HeterogeneousAgentBuildPlanParams,
  ) => Promise<HeterogeneousAgentBuildPlan>;
  createStreamProcessor: () => HeterogeneousAgentStreamProcessor;
}
