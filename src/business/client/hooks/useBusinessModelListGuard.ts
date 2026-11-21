/** A model the business layer lists in its own section above the provider list. */
export interface BusinessFeaturedModel {
  /** One line under the model name saying what it is for. */
  description?: string;
  modelId: string;
  providerId: string;
}

export interface BusinessModelListGuard {
  /**
   * Models listed first, in their own section, instead of in their provider's
   * list. A model that is not enabled is skipped.
   */
  featuredModels?: BusinessFeaturedModel[];
  /** Models left out of the list entirely (unlike restricted ones, which show locked). */
  isModelHidden?: (modelId: string, providerId: string) => boolean;
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
