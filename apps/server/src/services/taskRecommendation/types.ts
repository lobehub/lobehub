import type { CollectionDiagnostics, OnboardingTaskSource } from '@lobechat/types';

import type { ConnectorDataService } from '@/server/services/connectorData';

/** Data returned independently by one connector-specific recommendation provider. */
export interface CollectedTaskRecommendationContext {
  /** Bounded provider evidence serialized for one isolated agent call. */
  context: string;
  /** Partial-failure diagnostics from concurrent connector operations. */
  diagnostics: CollectionDiagnostics;
  /** Count of usable task signals represented in the context. */
  signalCount: number;
  /** Trusted connector records allowed to survive structured generation. */
  sources: OnboardingTaskSource[];
}

/** Connector-specific collector used by the onboarding recommendation workflow. */
export interface TaskRecommendationProvider {
  /**
   * Collects task-oriented evidence directly from this provider's connector client.
   *
   * Use when:
   * - The task workflow generates recommendations for this provider
   *
   * Expects:
   * - A user-scoped ConnectorDataService with a resolvable provider account
   *
   * Returns:
   * - Bounded serialized signals and partial-failure diagnostics
   */
  collect: (input: {
    connectorData: ConnectorDataService;
  }) => Promise<CollectedTaskRecommendationContext>;
  /** Connector identifier represented by this provider. */
  readonly id: 'github' | 'gmail';
}
