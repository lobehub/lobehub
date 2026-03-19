import type {
  BotPlatformRuntimeContext,
  BotProviderConfig,
  PlatformClient,
  PlatformDefinition,
  SerializedPlatformDefinition,
  ValidationResult,
} from './types';

/**
 * Platform registry — manages all platform definitions.
 *
 * Integrates with chat-sdk's Chat class by providing adapter creation
 * and credential validation through the registered platform definitions.
 */
export class PlatformRegistry {
  private platforms = new Map<string, PlatformDefinition>();

  /** Register a platform definition. Throws if the platform ID is already registered. */
  register(definition: PlatformDefinition): this {
    if (this.platforms.has(definition.id)) {
      throw new Error(`Platform "${definition.id}" is already registered`);
    }
    this.platforms.set(definition.id, definition);
    return this;
  }

  /** Get a platform definition by ID. */
  getPlatform(platform: string): PlatformDefinition | undefined {
    return this.platforms.get(platform);
  }

  /** List all registered platform definitions. */
  listPlatforms(): PlatformDefinition[] {
    return [...this.platforms.values()];
  }

  /** List platform definitions serialized for frontend consumption. */
  listSerializedPlatforms(): SerializedPlatformDefinition[] {
    return this.listPlatforms().map(({ clientFactory, ...rest }) => rest);
  }

  /**
   * Create a PlatformClient for a given platform.
   *
   * Looks up the platform definition and delegates to its createClient.
   * Throws if the platform is not registered.
   */
  createClient(
    platform: string,
    config: BotProviderConfig,
    context?: BotPlatformRuntimeContext,
  ): PlatformClient {
    const definition = this.platforms.get(platform);
    if (!definition) {
      throw new Error(`Platform "${platform}" is not registered`);
    }
    return definition.clientFactory.createClient(config, context ?? {});
  }

  /**
   * Validate credentials for a given platform.
   *
   * Delegates to the platform's clientFactory.validateCredentials.
   */
  async validateCredentials(
    platform: string,
    credentials: Record<string, string>,
    settings?: Record<string, unknown>,
    applicationId?: string,
  ): Promise<ValidationResult> {
    const definition = this.platforms.get(platform);
    if (!definition) {
      return {
        errors: [{ field: 'platform', message: `Platform "${platform}" is not registered` }],
        valid: false,
      };
    }
    return definition.clientFactory.validateCredentials(credentials, settings, applicationId);
  }
}
