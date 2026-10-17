import { isSafeSandboxCwd } from '@lobechat/builtin-tool-cloud-sandbox';
import { z } from 'zod';

/** Relative workspace path, validated with the same rule the runtime applies. */
export const relativePathSchema = z.string().refine(isSafeSandboxCwd, {
  message: 'Path must be a relative path inside the workspace',
});

/**
 * Topic whose warm sandbox session should serve the call, so listing a
 * directory does not cold-start a second sandbox next to the one the user is
 * already talking to.
 */
export const topicIdSchema = z.string().min(1).max(255).optional();

/**
 * A user-facing environment name. Distinct from the row's id, which is what the
 * execution plane stores the snapshot under and never changes — this is the
 * part a rename is allowed to move.
 */
export const nameSchema = z.string().trim().min(1).max(255);

/**
 * An environment or instance id. Checked for shape rather than left to the
 * lookup, because the lookup cannot answer: a non-UUID compared against a
 * `uuid` column is a Postgres type error, so the caller would get a server
 * fault where "no such environment" was the answer.
 *
 * An instance's id doubles as the name its snapshot is stored under, which is
 * why it never changes.
 */
export const idSchema = z.string().uuid();

/**
 * Who an environment resolves for inside a workspace. Personal environments
 * have no pool to join, so the server stores `private` for them whatever a
 * client sends.
 */
export const visibilitySchema = z.enum(['private', 'public']);
