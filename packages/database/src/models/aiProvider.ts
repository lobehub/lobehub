import type {
  AiProviderDetailItem,
  AiProviderListItem,
  AiProviderRuntimeConfig,
  CreateAiProviderParams,
  UpdateAiProviderConfigParams,
} from '@lobechat/types';
import { and, asc, desc, eq } from 'drizzle-orm';
import { isEmpty } from 'es-toolkit/compat';
import { ModelProvider } from 'model-bank';
import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';

import { merge } from '@/utils/merge';

import type { AiProviderSelectItem } from '../schemas';
import { aiModels, aiProviders } from '../schemas';
import type { LobeChatDatabase } from '../type';

type DecryptUserKeyVaults = (encryptKeyVaultsStr: string | null) => Promise<any>;

type EncryptUserKeyVaults = (keyVaults: string) => Promise<string>;

export class AiProviderModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  create = async (
    { keyVaults: userKey, ...params }: CreateAiProviderParams,
    encryptor?: EncryptUserKeyVaults,
  ) => {
    const defaultSerialize = (s: string) => s;
    const encrypt = encryptor ?? defaultSerialize;
    const keyVaults = await encrypt(JSON.stringify(userKey));

    const [result] = await this.db
      .insert(aiProviders)
      .values({
        ...params,
        // each new ai provider we will set it to enabled by default
        enabled: true,
        keyVaults,
        userId: this.userId,
      })
      .returning();

    return result;
  };

  delete = async (id: string) => {
    return this.db.transaction(async (trx) => {
      // 1. delete all models of the provider
      await trx
        .delete(aiModels)
        .where(and(eq(aiModels.providerId, id), eq(aiModels.userId, this.userId)));

      // 2. delete the provider
      await trx
        .delete(aiProviders)
        .where(and(eq(aiProviders.id, id), eq(aiProviders.userId, this.userId)));
    });
  };

  deleteAll = async () => {
    return this.db.delete(aiProviders).where(eq(aiProviders.userId, this.userId));
  };

  query = async () => {
    return this.db.query.aiProviders.findMany({
      orderBy: [desc(aiProviders.updatedAt)],
      where: eq(aiProviders.userId, this.userId),
    });
  };

  getAiProviderList = async (): Promise<AiProviderListItem[]> => {
    const result = await this.db
      .select({
        description: aiProviders.description,
        enabled: aiProviders.enabled,
        id: aiProviders.id,
        logo: aiProviders.logo,
        name: aiProviders.name,
        sort: aiProviders.sort,
        source: aiProviders.source,
      })
      .from(aiProviders)
      .where(eq(aiProviders.userId, this.userId))
      .orderBy(asc(aiProviders.sort), desc(aiProviders.updatedAt));

    return result as AiProviderListItem[];
  };

  findById = async (id: string) => {
    return this.db.query.aiProviders.findFirst({
      where: and(eq(aiProviders.id, id), eq(aiProviders.userId, this.userId)),
    });
  };

  update = async (id: string, value: Partial<AiProviderSelectItem>) => {
    return this.db
      .update(aiProviders)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(aiProviders.id, id), eq(aiProviders.userId, this.userId)));
  };

  updateConfig = async (
    id: string,
    value: UpdateAiProviderConfigParams,
    encryptor?: EncryptUserKeyVaults,
    decryptor?: DecryptUserKeyVaults,
  ) => {
    const defaultSerialize = (s: string) => s;
    const encrypt = encryptor ?? defaultSerialize;
    const decrypt = decryptor ?? JSON.parse;

    // Merge keyVaults with existing values to preserve OAuth tokens
    // when updating from form values that don't include them
    let mergedKeyVaults = value.keyVaults || {};

    const existing = await this.findById(id);
    if (existing?.keyVaults) {
      try {
        const existingKeyVaults = await decrypt(existing.keyVaults);
        // Merge: new values override existing, but preserve fields not in new values
        mergedKeyVaults = { ...existingKeyVaults, ...value.keyVaults };
      } catch {
        // Ignore decryption errors, use new values only
      }
    }

    const keyVaults = await encrypt(JSON.stringify(mergedKeyVaults));

    const commonFields = {
      checkModel: value.checkModel,
      config: value.config,
      fetchOnClient: value.fetchOnClient,
      keyVaults,
    };

    return this.db
      .insert(aiProviders)
      .values({
        ...commonFields,
        id,
        source: this.getProviderSource(id),
        userId: this.userId,
      })
      .onConflictDoUpdate({
        set: commonFields,
        target: [aiProviders.id, aiProviders.userId],
      });
  };

  toggleProviderEnabled = async (id: string, enabled: boolean) => {
    return this.db
      .insert(aiProviders)
      .values({
        enabled,
        id,
        source: this.getProviderSource(id),
        updatedAt: new Date(),
        userId: this.userId,
      })
      .onConflictDoUpdate({
        set: { enabled },
        target: [aiProviders.id, aiProviders.userId],
      });
  };

  updateOrder = async (sortMap: { id: string; sort: number }[]) => {
    await this.db.transaction(async (tx) => {
      const updates = sortMap.map(({ id, sort }) => {
        return tx
          .insert(aiProviders)
          .values({
            enabled: true,
            id,
            sort,
            source: this.getProviderSource(id),
            updatedAt: new Date(),
            userId: this.userId,
          })
          .onConflictDoUpdate({
            set: { sort, updatedAt: new Date() },
            target: [aiProviders.id, aiProviders.userId],
          });
      });

      await Promise.all(updates);
    });
  };

  getAiProviderById = async (
    id: string,
    decryptor?: DecryptUserKeyVaults,
  ): Promise<AiProviderDetailItem | undefined> => {
    const query = this.db
      .select({
        checkModel: aiProviders.checkModel,
        config: aiProviders.config,
        description: aiProviders.description,
        enabled: aiProviders.enabled,
        fetchOnClient: aiProviders.fetchOnClient,
        id: aiProviders.id,
        keyVaults: aiProviders.keyVaults,
        logo: aiProviders.logo,
        name: aiProviders.name,
        settings: aiProviders.settings,
        source: aiProviders.source,
      })
      .from(aiProviders)
      .where(and(eq(aiProviders.id, id), eq(aiProviders.userId, this.userId)))
      .limit(1);

    const [result] = await query;

    if (!result) {
      // if the provider is builtin but not init, we will insert it to the db
      if (this.isBuiltInProvider(id)) {
        await this.db.insert(aiProviders).values({ id, source: 'builtin', userId: this.userId });

        const resultAgain = await query;

        return { ...resultAgain[0] } as unknown as AiProviderDetailItem;
      }

      return;
    }

    const decrypt = decryptor ?? JSON.parse;

    let keyVaults = {};

    if (!!result.keyVaults) {
      try {
        keyVaults = await decrypt(result.keyVaults);
      } catch {
        /* empty */
      }
    }

    return {
      ...result,
      fetchOnClient: typeof result.fetchOnClient === 'boolean' ? result.fetchOnClient : undefined,
      keyVaults,
      settings: isEmpty(result.settings) ? undefined : result.settings,
    } as AiProviderDetailItem;
  };

  getAiProviderRuntimeConfig = async (decryptor?: DecryptUserKeyVaults) => {
    const result = await this.db
      .select({
        config: aiProviders.config,
        fetchOnClient: aiProviders.fetchOnClient,
        id: aiProviders.id,
        keyVaults: aiProviders.keyVaults,
        settings: aiProviders.settings,
      })
      .from(aiProviders)
      .where(and(eq(aiProviders.userId, this.userId)));

    const decrypt = decryptor ?? JSON.parse;
    const runtimeConfig: Record<string, AiProviderRuntimeConfig> = {};

    for (const item of result) {
      const builtin = DEFAULT_MODEL_PROVIDER_LIST.find((provider) => provider.id === item.id);

      const userSettings = item.settings || {};

      let keyVaults = {};
      if (!!item.keyVaults) {
        try {
          keyVaults = await decrypt(item.keyVaults);
        } catch {
          /* empty */
        }
      }

      runtimeConfig[item.id] = {
        config: item.config || {},
        fetchOnClient: typeof item.fetchOnClient === 'boolean' ? item.fetchOnClient : undefined,
        keyVaults,
        settings: !!builtin ? merge(builtin.settings, userSettings) : userSettings,
      };
    }

    return runtimeConfig;
  };

  private isBuiltInProvider = (id: string) => Object.values(ModelProvider).includes(id as any);

  private getProviderSource = (id: string) => (this.isBuiltInProvider(id) ? 'builtin' : 'custom');
}
