export interface BusinessModelModeConfig {
  chatConfig?: {
    enableAgentMode?: boolean;
  };
  model: string;
  provider: string;
}

export const useBusinessModelModeConfig = () => {
  return <T extends BusinessModelModeConfig>(config: T): T => config;
};

export const useBusinessCanEnableAgentMode = (_agentId: string): boolean => true;

export const useBusinessAgentModeSync = (_agentId: string): void => {};
