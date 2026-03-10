export interface BusinessModelListGuard {
  isModelRestricted?: (modelId: string) => boolean;
  onRestrictedModelClick?: () => void;
}

export const useBusinessModelListGuard = (): BusinessModelListGuard => {
  return {};
};
