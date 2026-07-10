import type { InstallationCredentials } from '../installations/types';
import type { MessengerPlatformBinder } from '../types';
import type { MessengerPlatformDefinition, SerializedMessengerPlatformDefinition } from './types';

/**
 * Messenger platform registry — manages all platform definitions.
 *
 * Mirrors `bot/platforms/registry.PlatformRegistry`: each definition owns its
 * binder factory and (optionally) the platform-specific webhook preprocessing
 * gate, so adding a new platform is a one-file change here plus the platform's
 * own binder + (optional) gate.
 */
export class MessengerPlatformRegistry {
  private platforms = new Map<string, MessengerPlatformDefinition>();

  /** Register a platform definition. Throws if the platform ID is already registered. */
  register(definition: MessengerPlatformDefinition): this {
    if (this.platforms.has(definition.id)) {
      throw new Error(`Messenger platform "${definition.id}" is already registered`);
    }
    this.platforms.set(definition.id, definition);
    return this;
  }

  /** Get a platform definition by ID. */
  getPlatform(platform: string): MessengerPlatformDefinition | undefined {
    return this.platforms.get(platform);
  }

  /** List all registered platform definitions. */
  listPlatforms(): MessengerPlatformDefinition[] {
    return [...this.platforms.values()];
  }

  /**
   * List platform definitions serialized for the frontend — drops the
   * factory and gate fields that aren't safe to ship over TRPC. Mirrors
   * `bot/platforms` `PlatformRegistry.listSerializedPlatforms`.
   */
  listSerializedPlatforms(): SerializedMessengerPlatformDefinition[] {
    return this.listPlatforms().map(({ createBinder, oauth, webhookGate, ...rest }) => rest);
  }

  /**
   * Build the per-platform binder for a resolved install. Returns null if the
   * platform isn't registered (so callers can `404` cleanly without throwing).
   */
  createBinder(creds: InstallationCredentials): MessengerPlatformBinder | null {
    const definition = this.platforms.get(creds.platform);
    return definition ? definition.createBinder(creds) : null;
  }
}
