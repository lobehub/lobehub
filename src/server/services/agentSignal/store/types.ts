import type { AgentSignalReceiptStore } from '../services/receiptService';

/** Persisted policy-state payload for one AgentSignal scope. */
export interface AgentSignalPolicyStatePayload {
  [key: string]: string;
}

/** Persisted source-event window payload for one AgentSignal scope. */
export interface AgentSignalSourceEventWindowPayload {
  [key: string]: string;
}

/** Storage contract for policy-scoped AgentSignal state. */
export interface AgentSignalPolicyStateStore {
  readPolicyState: (
    policyId: string,
    scopeKey: string,
  ) => Promise<AgentSignalPolicyStatePayload | undefined>;
  writePolicyState: (
    policyId: string,
    scopeKey: string,
    data: AgentSignalPolicyStatePayload,
    ttlSeconds: number,
  ) => Promise<void>;
}

/** Storage contract for AgentSignal source-event generation state. */
export interface AgentSignalSourceEventStore {
  acquireScopeLock: (scopeKey: string, ttlSeconds: number) => Promise<boolean>;
  readWindow: (scopeKey: string) => Promise<AgentSignalSourceEventWindowPayload | undefined>;
  releaseScopeLock: (scopeKey: string) => Promise<void>;
  tryDedupe: (eventId: string, ttlSeconds: number) => Promise<boolean>;
  writeWindow: (
    scopeKey: string,
    data: AgentSignalSourceEventWindowPayload,
    ttlSeconds: number,
  ) => Promise<void>;
}

export type { AgentSignalReceiptStore };
