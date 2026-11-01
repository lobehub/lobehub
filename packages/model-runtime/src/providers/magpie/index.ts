import { CURRENT_VERSION } from '@lobechat/const';
import type { ChatModelCard } from '@lobechat/types';
import { loadModels, MODEL_REASONING_EXTEND_PARAMS, ModelProvider } from 'model-bank';
import OpenAI from 'openai';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

type ModelSettings = NonNullable<ChatModelCard['settings']>;

/** The params that set how hard a model thinks, which a `reasoning: false` card must not offer. */
const REASONING_PARAMS = new Set<string>(MODEL_REASONING_EXTEND_PARAMS);

/**
 * One row of magpie's `GET /v1/models`.
 *
 * magpie serves every model the user has as `provider/model`, so an id is not
 * the vendor's own: `workbuddy/kimi-k3-1`, a routing group's `group/<id>` or
 * `auto/<model>`, and, with bare ids turned on, the model's name alone.
 *
 * The specs magpie can rewrite belong to magpie. Its window and reply limit
 * come from the vendor's list or models.dev and then from what the user set;
 * whether it takes images and which reasoning levels it has are the user's to
 * override too. Everything magpie neither lists nor rewrites is read from
 * model-bank.
 */
interface MagpieModelCard {
  context_length?: number;
  /** The user's name for the model, else the vendor's. */
  display_name?: string;
  id: string;
  /** The model's name as magpie's own lists label it, `· provider` and all. */
  magpie_label?: string;
  max_input_tokens?: number;
  max_output_tokens?: number;
  modalities?: {
    input?: string[];
    output?: string[];
  };
  native_endpoints?: string[];
  object?: string;
  owned_by?: string;
  pricing?: Record<string, unknown>;
  /** A model thinks when it has levels, or says so. */
  reasoning?: boolean;
  reasoning_levels?: string[];
  supported_reasoning_levels?: { effort: string }[];
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:3425';

/**
 * A magpie id reduced to the key model-bank knows the model by, spelt as magpie
 * spells one when it agrees on it (`internal/provider/group.go`'s `sameModel`):
 * lowercased, without the vendor's or the routing group's prefix, a version's
 * dot as a dash, whitespace, `_` and `-` as one dash, a vendor's snapshot date
 * off.
 */
export const magpieModelKey = (id: string): string => {
  let key = id.trim().toLowerCase();

  // A routing group magpie found goes by two ids: `auto/<model>`, the one it
  // hands out, and `group/auto-<slug>`, the one it keeps. The slug carries
  // `auto-` before the model's name, which the model itself never does.
  if (key.startsWith('group/auto-')) key = key.slice('group/auto-'.length);

  const slash = key.lastIndexOf('/');
  if (slash >= 0) key = key.slice(slash + 1);

  key = key.replaceAll(/[\s_-]+/gu, '-');

  // A version's dot, or Fireworks' `p` standing for one (`deepseek-v4p1`), as a
  // dash. Only between two digits, so `gpt-4o` keeps its name and `kimi-k3.1`
  // becomes `kimi-k3-1`, the id magpie serves that model under.
  key = key.replaceAll(/(?<=\d)[.p](?=\d)/g, '-');

  key = key.replace(/[-@]\d{8}$/, '');
  key = key.replace(/[-@]\d{6}$/, '');

  return key;
};

/** model-bank's entries, by the key a magpie id for one reduces to. */
const buildModelBankIndex = async () => {
  const index = new Map<string, any>();

  for (const model of await loadModels()) {
    const key = magpieModelKey(model.id);
    if (key && !index.has(key)) index.set(key, model);
  }

  return index;
};

/**
 * The model-bank entry for a magpie id, when one is the same model: matched on
 * the name after the provider prefix, so `workbuddy/kimi-k3-1` reaches
 * `kimi-k3.1`.
 *
 * A routing group reaches one too. `auto/kimi-k3.1` is the pool magpie found for
 * the model of that name across the providers serving it, so what model-bank
 * says of `kimi-k3.1` is what the group serves: it takes tool calls, it sees
 * images. Only the id stays the group's, since that is what a request reaches.
 */
const findKnownModel = (
  id: string,
  index: Map<string, any>,
  byId: Map<string, any>,
): any | undefined => byId.get(id) ?? index.get(magpieModelKey(id));

/**
 * magpie's own fields for one model, laid over model-bank's.
 *
 * Only what magpie can rewrite is written here, since a field this card hands
 * over wins over model-bank's. Tool calls are left to model-bank alone: magpie's
 * list says nothing of them, and `false` would turn a model's tool calls off.
 */
const fromMagpie = (model: MagpieModelCard): Partial<ChatModelCard> => {
  const contextWindow = model.context_length ?? model.max_input_tokens;

  // magpie answers what a model takes; saying nothing is no answer, not `false`.
  const takesImages = model.modalities?.input
    ? model.modalities.input.includes('image')
    : undefined;

  // A model thinks when magpie says so, or when it kept reasoning levels for it.
  // Its `false` is the user switching reasoning off, which must survive rather
  // than fall back to model-bank's answer.
  const levels = model.reasoning_levels ?? model.supported_reasoning_levels?.map((l) => l.effort);
  const thinks =
    model.reasoning === undefined ? (levels?.length ? true : undefined) : model.reasoning;

  return {
    displayName: plainName(model),
    ...(contextWindow ? { contextWindowTokens: contextWindow } : {}),
    ...(model.max_output_tokens ? { maxOutput: model.max_output_tokens } : {}),
    ...(takesImages === undefined ? {} : { vision: takesImages }),
    ...(thinks === undefined ? {} : { reasoning: thinks }),
  };
};

/** What magpie appends to a routing group's label, which LobeHub says by its tag. */
const ROUTING_GROUP_SUFFIX = ' · routing group';

/**
 * The name magpie gives a model, without the `· routing group` it appends: the
 * tag says that, drawn from the id.
 *
 * A `· provider` suffix stays. Two vendors serving one model are both listed
 * under magpie, so the row alone cannot tell them apart. Without the suffix the
 * picker shows two entries of one name with nothing to choose between them.
 */
const plainName = (model: MagpieModelCard): string | undefined => {
  const label = model.magpie_label;
  if (!label) return model.display_name;

  return label.endsWith(ROUTING_GROUP_SUFFIX)
    ? label.slice(0, -ROUTING_GROUP_SUFFIX.length)
    : label;
};

/**
 * model-bank's settings for one model, limited to the parts magpie leaves unsaid.
 *
 * `reasoning_levels` says a model thinks, not which parameter turns the
 * strength, and that parameter differs by model family (`gpt5_6ReasoningEffort`,
 * `kimiK3ReasoningEffort`, …), so the one this entry names is what puts the
 * choice in the chat settings at all.
 *
 * The reasoning params go when the user turned thinking off in magpie: the
 * card says `reasoning: false`, and offering a strength beside it would let a
 * choice be made for a model the gateway then pushes back up to its lowest
 * thinking level.
 *
 * `disabledParams` hides controls the vendor refuses. It never reaches a
 * request, since magpie drops what an upstream rejects, but the settings page
 * would otherwise offer a slider that does nothing. `searchImpl` and
 * `searchProvider` stay out: magpie's search is its own, not the vendor's
 * way of implementing it.
 */
const knownSettings = (
  known: any,
  thinks: boolean | undefined,
): Pick<ChatModelCard, 'settings'> => {
  const extendParams: ModelSettings['extendParams'] = known?.settings?.extendParams;
  const disabledParams: ModelSettings['disabledParams'] = known?.settings?.disabledParams;

  const usable =
    thinks === false ? extendParams?.filter((param) => !REASONING_PARAMS.has(param)) : extendParams;

  if (!usable?.length && !disabledParams) return {};

  return {
    settings: {
      ...(usable?.length ? { extendParams: usable } : {}),
      ...(disabledParams ? { disabledParams } : {}),
    },
  };
};

/**
 * What magpie serves, as model cards.
 *
 * The gateway's list is the only source: the models come and go with the
 * providers the user turns on there, so nothing is shipped in the card and
 * nothing is kept for a gateway that isn't running. model-bank fills what
 * magpie leaves unsaid, so a model magpie lists without one still takes tool
 * calls as its vendor's entry says.
 */
const fetchMagpieModels = async (client: OpenAI): Promise<ChatModelCard[]> => {
  const response = await client.models.list();
  const rows = (response.data as unknown as MagpieModelCard[]).filter((row) => !!row?.id);

  const models = await loadModels();
  const index = await buildModelBankIndex();
  const byId = new Map(models.map((model) => [model.id, model]));

  const prepared = rows.map((row) => {
    const known = findKnownModel(row.id, index, byId);
    const card = fromMagpie(row);

    return {
      id: row.id,
      ...card,
      // What magpie never says anything about, and only model-bank knows.
      ...(known?.abilities?.functionCall === undefined
        ? {}
        : { functionCall: known.abilities.functionCall }),
      // `card.reasoning` is magpie's own answer, so a model it reports as not
      // thinking offers no strength to choose.
      ...knownSettings(known, card.reasoning),
    };
  });

  // magpie lists a model by its bare id too when the user asks for it, next to
  // its `provider/model` row. The bare row names the same model, so the
  // prefixed one is kept and the alias dropped. Two providers serving one model
  // stay apart: their ids both carry a prefix.
  const byName = new Set<string>();
  for (const card of prepared) {
    if (card.id.includes('/')) byName.add(card.id.slice(card.id.lastIndexOf('/') + 1));
  }

  const seen = new Set<string>();
  const unique = prepared.filter((card) => {
    if (seen.has(card.id)) return false;

    // A bare id, when a prefixed row already names that model.
    if (!card.id.includes('/') && byName.has(card.id)) return false;

    seen.add(card.id);
    return true;
  });

  return processMultiProviderModelList(unique, ModelProvider.Magpie);
};

export const params = {
  apiKey: 'placeholder-to-avoid-error',
  baseURL: `${DEFAULT_BASE_URL}/v1`,
  customClient: {
    // The gateway names the caller by its key (`magpie-<app>`) or else by its
    // User-Agent. The OpenAI SDK builds one from its class name, which a
    // minified build shortens to a single letter, so magpie would count
    // LobeHub's calls under that letter.
    createClient: (options: any) =>
      new OpenAI({
        ...options,
        defaultHeaders: {
          'User-Agent': `lobehub/${CURRENT_VERSION}`,
          ...options?.defaultHeaders,
        },
      }),
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_MAGPIE_CHAT_COMPLETION === '1',
    responses: () => process.env.DEBUG_MAGPIE_RESPONSES === '1',
  },
  models: async ({ client }: { client: OpenAI }) => fetchMagpieModels(client),
  provider: ModelProvider.Magpie,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeMagpieAI = createOpenAICompatibleRuntime(params);
