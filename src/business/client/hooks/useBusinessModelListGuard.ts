export interface BusinessModelListGuard {
  isModelRestricted?: (modelId: string, providerId: string) => boolean;
  onBeforeModelSelect?: (modelId: string, providerId: string) => boolean | Promise<boolean>;
  onRestrictedModelClick?: () => void;
  /**
   * Badge shown on a restricted model. Returning `undefined` keeps the common `pro`
   * label; a business override names a different tier per model.
   */
  restrictedBadgeLabel?: (modelId: string, providerId: string) => string | undefined;
  sortModelLast?: (modelId: string, providerId: string) => boolean;
}

export const useBusinessModelListGuard = (): BusinessModelListGuard => {
  return {};
};
