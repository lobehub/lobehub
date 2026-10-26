import { CURRENT_VERSION } from '@lobechat/const';
import type { ChatModelCard } from '@lobechat/types';
import { loadModels, ModelProvider } from 'model-bank';
import OpenAI from 'openai';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

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
  // becomes `kimi-k3-1` — the id magpie serves that model under.
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
    // A routing group's `magpie_label` ends in `· routing group` and a model two
    // vendors serve ends in `· provider`. LobeHub says the first itself, from the
    // id, and tells the second by the provider each row is under, so the name
    // alone is what it shows.
    displayName: plainName(model),
    ...(contextWindow ? { contextWindowTokens: contextWindow } : {}),
    ...(model.max_output_tokens ? { maxOutput: model.max_output_tokens } : {}),
    ...(takesImages === undefined ? {} : { vision: takesImages }),
    ...(thinks === undefined ? {} : { reasoning: thinks }),
  };
};

/**
 * The name magpie gives a model without the `· …` it adds: a routing group's
 * `· routing group`, and a `· provider` that tells two vendors' models of one
 * name apart. Both are magpie's own wording for what the row is, which LobeHub
 * says in its own way; `display_name` is the name on its own.
 */
const plainName = (model: MagpieModelCard): string | undefined => {
  const label = model.magpie_label;
  if (!label) return model.display_name;

  const cut = label.lastIndexOf(' · ');

  return cut > 0 ? label.slice(0, cut) : label;
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

    return {
      id: row.id,
      ...fromMagpie(row),
      // What magpie never says anything about, and only model-bank knows.
      ...(known?.abilities?.functionCall === undefined
        ? {}
        : { functionCall: known.abilities.functionCall }),
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
