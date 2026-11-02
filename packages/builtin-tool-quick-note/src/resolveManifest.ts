import type { BuiltinManifestResolver } from '@lobechat/types';

import { QuickNoteManifest } from './manifest';

/**
 * Context-aware manifest for the Quick Note submit tool.
 *
 * The tool only means something inside a Quick Note follow-up run (`scope` is `quick_note`),
 * which mounts it explicitly. Everywhere else it is unavailable, even when an Agent pins it.
 */
export const resolveQuickNoteManifest: BuiltinManifestResolver = (context) =>
  context.scope === 'quick_note' ? QuickNoteManifest : null;
