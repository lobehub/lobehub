export interface BusinessModelListGuard {
  isModelRestricted?: (modelId: string, providerId: string) => boolean;
  onRestrictedModelClick?: () => void;
}

export const useBusinessModelListGuard = (): BusinessModelListGuard => {
  return {};
};
