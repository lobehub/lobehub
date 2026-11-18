import type { DynamicInterventionResolver } from '@lobechat/types';

/** Registry key of the `deleteFiles` approval audit (see `dynamicInterventionAudits`). */
export const CLOUD_SANDBOX_DELETE_AUDIT = 'cloudSandboxDeleteAudit';

/**
 * Deleting from the drive is permanent, so a `deleteFiles` call asks the user
 * first — unless it is flagged `regenerableOnly`. That flag is not taken on
 * trust: the storage service refuses the whole call when any path is not a
 * dependency directory, a cache or build output (checked on the volume, not
 * by name alone), so what runs unattended is only what an install or build
 * puts back. Anything else, a missing flag included, asks — with the
 * manifest's `always` policy, so auto-run mode cannot skip it either.
 */
export const deleteFilesAudit: DynamicInterventionResolver = async (toolArgs) =>
  toolArgs?.regenerableOnly !== true;
