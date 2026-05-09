import type { EvidenceRef } from './types';

/** Shared fields for skill maintenance domain requests. */
export interface SkillMaintenanceBaseInput {
  /** Whether the resolved target is immutable because it is builtin, marketplace, or otherwise protected. */
  targetReadonly?: boolean;
  /** User that owns the writable managed skill. */
  userId: string;
}

/** Input for creating a managed skill. */
export interface CreateMaintenanceSkillInput extends SkillMaintenanceBaseInput {
  /** Skill body or authoring payload. */
  bodyMarkdown?: string;
  /** Optional description. */
  description?: string;
  /** Stable skill name. */
  name?: string;
  /** Optional title. */
  title?: string;
}

/** Input for refining an existing managed skill. */
export interface RefineMaintenanceSkillInput extends SkillMaintenanceBaseInput {
  /** Patch, replacement body, or maintainer payload. */
  patch?: string;
  /** Writable managed skill agent document id. */
  skillDocumentId: string;
}

/** Input for consolidating managed skills into a canonical skill. */
export interface ConsolidateMaintenanceSkillInput extends SkillMaintenanceBaseInput {
  /** Approval context that allows a consolidation mutation. */
  approval?: {
    /** Source of the approval decision. */
    source: 'proposal' | 'same_turn_feedback';
  };
  /** Canonical writable managed skill agent document id. */
  canonicalSkillDocumentId: string;
  /** Source managed skill ids used to build the canonical skill. */
  sourceSkillIds: string[];
}

/** Request envelope for creating one skill. */
export interface SkillMaintenanceCreateRequest {
  /** Evidence supporting the skill creation. */
  evidenceRefs: EvidenceRef[];
  /** Stable action idempotency key. */
  idempotencyKey: string;
  /** Domain payload. */
  input: CreateMaintenanceSkillInput;
}

/** Request envelope for refining one skill. */
export interface SkillMaintenanceRefineRequest {
  /** Evidence supporting the refinement. */
  evidenceRefs: EvidenceRef[];
  /** Stable action idempotency key. */
  idempotencyKey: string;
  /** Domain payload. */
  input: RefineMaintenanceSkillInput;
}

/** Request envelope for consolidating managed skills. */
export interface SkillMaintenanceConsolidateRequest {
  /** Evidence supporting the consolidation. */
  evidenceRefs: EvidenceRef[];
  /** Stable action idempotency key. */
  idempotencyKey: string;
  /** Domain payload. */
  input: ConsolidateMaintenanceSkillInput;
}

/** Result returned by skill maintenance adapters. */
export interface SkillMaintenanceResult {
  /** Affected writable managed skill document id. */
  skillDocumentId: string;
  /** Optional short persistence summary. */
  summary?: string;
}

/** Persistence adapters for managed skill maintenance operations. */
export interface SkillMaintenanceAdapters {
  /** Consolidates managed skills through the existing skill stack. */
  consolidateSkill?: (
    request: SkillMaintenanceConsolidateRequest,
  ) => Promise<SkillMaintenanceResult>;
  /** Creates managed skills through the existing skill stack. */
  createSkill?: (request: SkillMaintenanceCreateRequest) => Promise<SkillMaintenanceResult>;
  /** Refines managed skills through the existing skill stack. */
  refineSkill?: (request: SkillMaintenanceRefineRequest) => Promise<SkillMaintenanceResult>;
}

const assertWritableSkill = (targetReadonly: boolean | undefined) => {
  if (targetReadonly) {
    throw new Error('Skill target is readonly');
  }
};

const assertApprovedConsolidation = (input: ConsolidateMaintenanceSkillInput) => {
  if (!input.approval) {
    throw new Error('Skill consolidation requires proposal or explicit same-turn approval');
  }
};

/**
 * Creates a skill management maintenance service.
 *
 * Use when:
 * - Maintenance executor needs one skill domain validation boundary
 * - Same-turn skill actions need to share target immutability and consolidation guards
 *
 * Expects:
 * - Builtin and marketplace skills are marked `targetReadonly` before mutation
 * - Server callers inject adapters backed by the existing managed-skill stack
 *
 * Returns:
 * - A service that validates skill targets before delegating persistence
 */
export const createSkillManagementService = (adapters: SkillMaintenanceAdapters = {}) => ({
  consolidateSkill: async (
    request: SkillMaintenanceConsolidateRequest,
  ): Promise<SkillMaintenanceResult> => {
    assertWritableSkill(request.input.targetReadonly);
    assertApprovedConsolidation(request.input);

    if (!adapters.consolidateSkill) {
      throw new Error('Skill consolidate adapter is required');
    }

    return adapters.consolidateSkill(request);
  },
  createSkill: async (request: SkillMaintenanceCreateRequest): Promise<SkillMaintenanceResult> => {
    assertWritableSkill(request.input.targetReadonly);

    if (!adapters.createSkill) {
      throw new Error('Skill create adapter is required');
    }

    return adapters.createSkill(request);
  },
  refineSkill: async (request: SkillMaintenanceRefineRequest): Promise<SkillMaintenanceResult> => {
    assertWritableSkill(request.input.targetReadonly);

    if (!adapters.refineSkill) {
      throw new Error('Skill refine adapter is required');
    }

    return adapters.refineSkill(request);
  },
});
