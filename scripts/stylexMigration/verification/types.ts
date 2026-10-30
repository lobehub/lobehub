import { z } from 'zod';

const nonempty = z.string().min(1).max(8192);
const unique = <T>(values: T[]) => new Set(values).size === values.length;

export const machineStatusSchema = z.enum(['PASS', 'FAIL', 'NEEDS_REVIEW', 'ERROR']);
export type MachineStatus = z.infer<typeof machineStatusSchema>;

export const coverageUnitSchema = z.strictObject({
  componentId: nonempty,
  fixtureIds: z.array(nonempty).refine(unique, 'Duplicate fixture ID'),
  id: nonempty,
  requiredKeys: z.array(nonempty).refine(unique, 'Duplicate coverage key'),
});

export const witnessSchema = z.strictObject({
  evidenceRefs: z.array(nonempty),
  fixtureId: nonempty,
  key: nonempty,
  probeId: nonempty,
  unitId: nonempty,
});

export const gateInputSchema = z.strictObject({
  errors: z.array(nonempty),
  findings: z
    .array(
      z.strictObject({
        confirmed: z.boolean(),
        id: nonempty,
        reasonCode: nonempty,
        severity: z.enum(['difference', 'review']),
      }),
    )
    .refine((values) => unique(values.map((value) => value.id)), 'Duplicate finding ID'),
  fixtures: z
    .array(
      z.strictObject({
        aaStable: z.boolean(),
        comparisons: z.number().int().nonnegative(),
        id: nonempty,
        nodeCount: z.number().int().nonnegative(),
        propertyReads: z.number().int().nonnegative(),
      }),
    )
    .refine((values) => unique(values.map((value) => value.id)), 'Duplicate fixture ID'),
  fullScope: z.boolean(),
  identityVerified: z.boolean(),
  pureStyleMigration: z.boolean(),
  units: z
    .array(coverageUnitSchema)
    .refine((values) => unique(values.map((value) => value.id)), 'Duplicate unit ID'),
  witnesses: z.array(witnessSchema),
});

export type GateInput = z.infer<typeof gateInputSchema>;
export type CoverageUnit = z.infer<typeof coverageUnitSchema>;

export interface CoverageSummary {
  machineResolvedUnits: number;
  missingKeys: string[];
  requiredKeys: number;
  reviewResolvedUnits: number;
  totalUnits: number;
  unresolvedUnitIds: string[];
  witnessedKeys: number;
}

export interface GateDecision {
  coverage: CoverageSummary;
  errors: string[];
  findings: GateInput['findings'];
  gateEligible: boolean;
  reasonCodes: string[];
  status: MachineStatus;
}

export interface RevisionIdentity {
  baseSha: string;
  candidateTreeSha: string;
  headSha: string;
  repository: string;
}

export interface SourceEntry {
  bytes: number;
  mode: string;
  oid: string;
  path: string;
  type: string;
}

export interface RevisionSession {
  directory: string;
  identity: RevisionIdentity;
  sourceRepository: string;
}

export interface ScopeUnit {
  blobSha: string;
  end: number;
  file: string;
  id: string;
  kind: 'source' | 'style-slot' | 'stylesheet' | 'opaque';
  label: string;
  side: 'base' | 'candidate';
  start: number;
}

export interface ScopeInventory {
  changedFiles: Array<{ after?: string; before?: string; status: string }>;
  hash: string;
  limitations: string[];
  units: ScopeUnit[];
}
