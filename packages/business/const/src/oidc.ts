/**
 * OIDC business slots.
 *
 * The open-source distribution registers its own first-party clients in
 * `src/libs/oidc-provider/config.ts`. A distribution adds further statically
 * registered clients here, and decides which signed-in apps may hand a session
 * to which native apps on the same machine (`OIDC_NATIVE_HANDOFF`). Both
 * default to empty, which leaves the native handoff endpoint switched off.
 */

/**
 * The subset of oidc-provider client metadata a distribution registers.
 * Kept structural so this package does not depend on oidc-provider.
 */
export interface BusinessOidcClientMetadata {
  [key: string]: unknown;
  application_type?: 'native' | 'web';
  client_id: string;
  client_name?: string;
  grant_types?: string[];
  logo_uri?: string;
  post_logout_redirect_uris?: string[];
  redirect_uris?: string[];
  response_types?: string[];
  scope?: string;
  token_endpoint_auth_method?: string;
}

/**
 * How a desktop app recognises the executable that asks it for a handoff,
 * per platform. A platform without an entry (or a check that fails) falls back
 * to asking the user in a native confirmation dialog.
 */
export interface NativeHandoffTargetVerification {
  /** Absolute install directories, owned by root and not writable by the user. */
  linux?: { exeDirs: string[] };
  /** A code requirement passed to `codesign --verify -R=<requirement>`. */
  mac?: { designatedRequirement: string };
  /** The Authenticode signer subject (`CN=…, O=…`) the executable must carry. */
  win?: { signerSubject: string };
}

export interface NativeHandoffTarget {
  /** A registered `native` client allowed to receive handoff codes. */
  clientId: string;
  /** Shown in the desktop confirmation dialog. */
  name: string;
  verification?: NativeHandoffTargetVerification;
}

export interface NativeHandoffPolicy {
  /** Client ids whose access tokens may request a handoff (e.g. the desktop app). */
  from: string[];
  /** Native clients a handoff code may be issued to. */
  to: NativeHandoffTarget[];
}

export const BUSINESS_OIDC_CLIENTS: BusinessOidcClientMetadata[] = [];

export const OIDC_NATIVE_HANDOFF: NativeHandoffPolicy = { from: [], to: [] };
