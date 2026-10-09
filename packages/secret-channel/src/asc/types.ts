/**
 * ASC core types (spec §5). Nothing in here carries a secret value: a request is metadata that a
 * Relay may store and a Host may show to the model.
 */
import type { AscSuite, ASC_VERSION } from './constants';

/** What the human is asked for (spec §5.2, registry §11.2). */
export type AscSecretKind = 'password' | 'passphrase' | 'token' | 'otp' | 'approval' | (string & {});

/** Where the secret goes, as observed by the Executor (spec §5.2, registry §11.3). */
export type AscTargetKind =
  | 'sudo'
  | 'ssh'
  | 'git'
  | 'pty-prompt'
  | 'env-run'
  | 'oauth'
  | 'mcp-url'
  | (string & {});

/** Strength of the Executor's peer verification (spec §4.5). */
export type AscVerification = 'verified' | 'unverified';

export interface AscTarget {
  /** Human-readable argv as observed by the Executor, redacted; bound via displayHash. */
  argvDisplay: string;
  /** base64url(SHA-256(encodeFields(argv))) (spec §6.4.2). */
  argvHash: string;
  /** Absolute executable path of the sink as reported by the OS; '' when not applicable. */
  exePath: string;
  kind: AscTargetKind;
  /** Prompt text the sink passed to the Askpass helper; bound via displayHash. */
  promptText?: string;
  verification: AscVerification;
}

export interface AscExecutorBinding {
  /** Stable, opaque Executor identifier. */
  executorId: string;
  /** Human-readable Executor name shown to the user; bound via displayHash. */
  executorName: string;
  /** Per-request X25519 public key, raw 32 bytes, base64url. */
  ephPub: string;
  /** `SHA256:` + base64url(SHA-256(identityPublicKey raw)). */
  identityKeyFp: string;
  /** Long-term Ed25519 public key, raw 32 bytes, base64url. */
  identityPublicKey: string;
  /** Ed25519 over ASC_SIGNATURE_CONTEXT ‖ AAD, base64url. */
  sig: string;
}

export interface AscRequest {
  createdAt: number;
  executor: AscExecutorBinding;
  expiresAt: number;
  id: string;
  kind: AscSecretKind;
  label: string;
  persistence: 'once';
  purpose: {
    /** Requester-supplied explanation. Untrusted, NOT bound; Hosts label it as unverified. */
    agentClaim?: string;
    /** Executor-generated description of the observed target; bound via displayHash. */
    systemObserved: string;
  };
  /** Suite label (spec §6.1, §6.10); absent means the Base suite. Bound as AAD field 2. */
  suite?: AscSuite;
  requester: {
    /** Identifier of the agent run the request belongs to; bound into the AAD. */
    runId: string;
    source: 'askpass' | 'tool' | 'pty-detect' | 'user-initiated' | (string & {});
  };
  target: AscTarget;
  v: typeof ASC_VERSION;
}

/** Client → Relay → Executor (spec §6.8). */
export interface AscEnvelope {
  ct: string;
  enc: string;
  requestId: string;
  /** Auth suite only: clientKeyFp of the sealing Client key (spec §6.10). */
  sender?: string;
  suite: AscSuite;
  v: typeof ASC_VERSION;
}

/** The only result a Requester (agent) ever receives (spec §5.4). */
export interface AscGrantResult {
  attempt?: number;
  note?: string;
  requestId: string;
  status: 'provided' | 'denied' | 'expired' | 'authorized' | 'failed';
}
