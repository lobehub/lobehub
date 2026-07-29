/* eslint-disable regexp/no-unused-capturing-group */
/**
 * Rule-based derivation of { family, generation } from normalized model ids.
 * Principle: only fill what is confidently derivable; otherwise omit.
 *
 * Usage: bun /tmp/derive-family.ts            # print distinct pairs for review
 *        bun /tmp/derive-family.ts --emit     # write /tmp/family-map.json
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ids: string[] = JSON.parse(readFileSync('/tmp/model-ids.json', 'utf8'));

type R = { family: string; generation?: string };

const derive = (id: string): R | undefined => {
  // strip cloud/bedrock prefixes for matching
  const m = id.replace(/^(us\.|global\.|eu\.|apac\.)?(anthropic\.|meta\.|cohere\.|azure-)/, '');

  // ---- anthropic ----
  if (m.startsWith('claude')) {
    // family = product-line tier (claude-opus/sonnet/haiku/instant); bare claude-2.x has no tier
    const tier = m.match(/(opus|sonnet|haiku|instant)/)?.[1];
    const family = tier ? `claude-${tier}` : 'claude';
    let g = m.match(/^claude-(?:opus|sonnet|haiku)-(\d)[.-](\d)(?!\d)/); // claude-opus-4-8 / claude-haiku-4.5
    if (g) return { family, generation: `claude-${g[1]}.${g[2]}` };
    g = m.match(/^claude-(?:opus|sonnet|haiku)-(\d)(?!\d)/); // claude-opus-4
    if (g) return { family, generation: `claude-${g[1]}` };
    g = m.match(/^claude-(\d)[.-](\d)(?!\d)/); // claude-3-5-haiku / claude-3.7-sonnet / claude-2.1
    if (g) return { family, generation: g[2] === '0' ? `claude-${g[1]}` : `claude-${g[1]}.${g[2]}` };
    g = m.match(/^claude-(\d)(?!\d)/); // claude-3-haiku
    if (g) return { family, generation: `claude-${g[1]}` };
    if (m.startsWith('claude-instant')) return { family: 'claude-instant' };
    if (/^claude-v?2/.test(m)) return { family: 'claude', generation: 'claude-2' };
    return { family };
  }

  // ---- openai ----
  if (/^(gpt-oss|gpt_oss)/.test(m) || m.startsWith('gpt-oss:'))
    return { family: 'gpt-oss', generation: 'gpt-oss' };
  if (/^(chatgpt-4o|gpt-4o)/.test(m)) return { family: 'gpt', generation: 'gpt-4o' };
  if (/^gpt-(3\.5|35)/.test(m)) return { family: 'gpt', generation: 'gpt-3.5' };
  if (m.startsWith('gpt-audio')) return { family: 'gpt', generation: 'gpt-audio' };
  {
    const g = m.match(/^gpt-(\d)\.(\d)/); // gpt-4.1 / gpt-5.2
    if (g) return { family: 'gpt', generation: `gpt-${g[1]}.${g[2]}` };
    const g2 = m.match(/^gpt-(\d)(?!\d)/); // gpt-4 / gpt-5
    if (g2) return { family: 'gpt', generation: `gpt-${g2[1]}` };
  }
  {
    const g = m.match(/^o([134])(-|$)/); // o1 / o3 / o4
    if (g) return { family: 'o-series', generation: `o${g[1]}` };
  }
  if (/^(codex|computer-use-preview)/.test(m)) return { family: 'gpt' };

  // ---- google ----
  {
    const g = m.match(/^gemini-(\d+(?:\.\d+)?)/);
    if (g) return { family: 'gemini', generation: `gemini-${g[1]}` };
    if (/^gemini-(pro|flash)/.test(m)) return { family: 'gemini' }; // rolling aliases
    if (m.startsWith('gemma')) {
      if (/^gemma-?\db/.test(m)) return { family: 'gemma', generation: 'gemma-1' };
      const v = m.match(/^gemma-?(\d)(?!b)/);
      return { family: 'gemma', generation: v ? `gemma-${v[1]}` : undefined };
    }
    if (/^(codegemma|learnlm|palm)/.test(m)) return { family: m.match(/^[a-z]+/)![0] };
  }

  // ---- qwen ----
  if (m.startsWith('qwq')) return { family: 'qwen', generation: 'qwq' };
  if (m.startsWith('qvq')) return { family: 'qwen', generation: 'qvq' };
  if (m.startsWith('codeqwen')) return { family: 'qwen' };
  if (m.startsWith('qwen')) {
    const g =
      m.match(/^qwen-?([123](?:\.\d+)?)(?![0-9b])/) || // qwen3.5-plus / qwen-3-14b / qwen2-7b / qwen1.5
      m.match(/^qwen([23](?:\.\d+)?):/) || // qwen2.5:72b
      m.match(/^qwen([23])p(\d)/); // qwen2p5 -> handled below
    if (/^qwen(\d)p(\d)/.test(m)) {
      const p = m.match(/^qwen(\d)p(\d)/)!;
      return { family: 'qwen', generation: `qwen${p[1]}.${p[2]}` };
    }
    if (g) return { family: 'qwen', generation: `qwen${g[1]}` };
    return { family: 'qwen' }; // qwen-max/plus/turbo/vl rolling aliases
  }

  // ---- deepseek ----
  if (/^(deepseek|azure-deepseek|pro-deepseek)/.test(m) || m.startsWith('deepseek_')) {
    const s = m.replace(/^pro-/, '').replaceAll('_', '-');
    if (s.startsWith('deepseek-r1-distill'))
      return { family: 'deepseek', generation: 'deepseek-r1-distill' };
    if (s.startsWith('deepseek-r1')) return { family: 'deepseek', generation: 'deepseek-r1' };
    const g = s.match(/^deepseek-(?:chat-)?v(\d(?:\.\d)?)/);
    if (g) return { family: 'deepseek', generation: `deepseek-v${g[1]}` };
    if (/^deepseek-(coder-v2|coder)/.test(s))
      return { family: 'deepseek', generation: 'deepseek-coder' };
    return { family: 'deepseek' }; // deepseek-chat / reasoner rolling aliases
  }

  // ---- meta llama ----
  if (m.startsWith('codellama')) return { family: 'llama', generation: 'codellama' };
  if (/^(meta-)?llama|^l3(\d)?-|^llava/.test(m)) {
    if (m.startsWith('llava')) return { family: 'llava' };
    const s = m.replace(/^meta-/, '');
    const g =
      s.match(/^llama-?([234])(?:[.-](\d))?(?![0-9b])/) || // llama-3.1 / llama3.3 / llama-4
      s.match(/^llama-?v([234])p?(\d)?/) || // llama-v3p1
      s.match(/^llama([234])[.:-](\d)?/);
    if (g) {
      const gen = g[2] ? `llama-${g[1]}.${g[2]}` : `llama-${g[1]}`;
      return { family: 'llama', generation: gen };
    }
    if (m.startsWith('l3-')) return { family: 'llama', generation: 'llama-3' };
    if (m.startsWith('l31-')) return { family: 'llama', generation: 'llama-3.1' };
    return { family: 'llama' };
  }

  // ---- zhipu ----
  if (/^(zai-)?glm/.test(m)) {
    const s = m.replace(/^zai-/, '');
    if (s.startsWith('glm-z1')) return { family: 'glm', generation: 'glm-z1' };
    if (s.startsWith('glm-zero')) return { family: 'glm', generation: 'glm-zero' };
    const g = s.match(/^glm-(\d(?:\.\d)?)/);
    if (g) return { family: 'glm', generation: `glm-${g[1]}` };
    return { family: 'glm' };
  }
  if (/^(charglm|codegeex|emohaa)/.test(m)) return { family: m.match(/^[a-z]+/)![0] };

  // ---- mistral ----
  if (
    /^(open-)?(mistral|mixtral|ministral|codestral|devstral|magistral|pixtral|mathstral|labs-devstral|labs-leanstral|open-codestral)/.test(
      m,
    )
  ) {
    const fam = m.replace(/^(open-|labs-)/, '').match(/^[a-z]+/)![0];
    return { family: fam };
  }

  // ---- xai ----
  if (m.startsWith('grok')) {
    const g = m.match(/^grok-(\d(?:\.\d+)?)/);
    return { family: 'grok', generation: g ? `grok-${g[1]}` : undefined };
  }

  // ---- moonshot ----
  if (m.startsWith('kimi')) {
    const g = m.match(/^kimi-k(\d(?:\.\d)?)/);
    return { family: 'kimi', generation: g ? `kimi-k${g[1]}` : undefined };
  }
  if (m.startsWith('moonshot-kimi-k2')) return { family: 'kimi', generation: 'kimi-k2' };
  if (m.startsWith('moonshot-v1')) return { family: 'kimi', generation: 'moonshot-v1' };

  // ---- minimax ----
  if (m.startsWith('minimax')) {
    if (m.startsWith('minimax-text')) return { family: 'minimax', generation: 'minimax-text-01' };
    const g = m.match(/^minimax-m(\d(?:\.\d)?)/);
    return { family: 'minimax', generation: g ? `minimax-m${g[1]}` : undefined };
  }
  if (m.startsWith('abab')) return { family: 'minimax', generation: 'abab' };

  // ---- baidu ----
  if (m.startsWith('ernie')) {
    if (m.startsWith('ernie-x1')) return { family: 'ernie', generation: 'ernie-x1' };
    const g = m.match(/^ernie-(\d\.\d)/);
    return { family: 'ernie', generation: g ? `ernie-${g[1]}` : undefined };
  }
  if (m.startsWith('qianfan')) return { family: 'qianfan' };

  // ---- bytedance ----
  if (m.startsWith('doubao')) {
    const g = m.match(/^doubao-seed-(\d[.-]\d|\d)/) || m.match(/^doubao-(\d\.\d)/);
    return { family: 'doubao', generation: g ? `doubao-${g[1].replace('-', '.')}` : undefined };
  }
  if (/^(seed-oss|skylark)/.test(m)) return { family: m.startsWith('seed') ? 'doubao' : 'skylark' };

  // ---- tencent ----
  if (m.startsWith('hunyuan')) {
    const g = m.match(/^hunyuan-(\d\.\d)/);
    return { family: 'hunyuan', generation: g ? `hunyuan-${g[1]}` : undefined };
  }
  if (m.startsWith('hy3')) return { family: 'hunyuan', generation: 'hunyuan-3' };

  // ---- others (family only / simple version) ----
  if (m.startsWith('yi-')) return { family: 'yi' };
  if (/^(command|c4ai-command)/.test(m)) return { family: 'command' };
  if (/^(aya|c4ai-aya)/.test(m)) return { family: 'aya' };
  if (/^phi-?(\d)?/.test(m) && m.startsWith('phi')) {
    const g = m.match(/^phi-?(\d(?:\.\d)?)/);
    return { family: 'phi', generation: g ? `phi-${g[1]}` : undefined };
  }
  if (m.startsWith('wizardlm')) return { family: 'wizardlm' };
  if (m.startsWith('step-')) {
    const g = m.match(/^step-(?:r1|(\d(?:\.\d)?))/);
    return { family: 'step', generation: g?.[1] ? `step-${g[1]}` : undefined };
  }
  if (/^(internlm|intern-)/.test(m)) return { family: 'intern' };
  if (m.startsWith('internvl')) return { family: 'internvl' };
  if (m.startsWith('baichuan')) {
    const g = m.match(/^baichuan-?(m?\d)/);
    return { family: 'baichuan', generation: g ? `baichuan-${g[1]}` : undefined };
  }
  if (/^(sensechat|sensenova)/.test(m)) return { family: 'sensenova' };
  if (/^(spark|generalv|4\.0ultra)/.test(m)) return { family: 'spark' };
  if (/^(360gpt|360zhinao)/.test(m)) return { family: '360zhinao' };
  if (/^(jamba|ai21-jamba)/.test(m)) return { family: 'jamba' };
  if (m.startsWith('sonar')) return { family: 'sonar' };
  if (/^(nova-lite|nova-micro|nova-pro)/.test(m)) return { family: 'nova' };
  if (/^(ling|ring)-/.test(m)) return { family: m.match(/^[a-z]+/)![0] };
  if (m.startsWith('longcat')) return { family: 'longcat' };
  if (m.startsWith('mimo')) return { family: 'mimo' };
  if (m.startsWith('taichu')) return { family: 'taichu' };
  if (/^(hermes|nous-hermes)/.test(m)) return { family: 'hermes' };
  if (m.startsWith('solar')) return { family: 'solar' };
  if (m.startsWith('kat-coder')) return { family: 'kat-coder' };
  if (m.startsWith('dbrx')) return { family: 'dbrx' };
  if (m.startsWith('morph')) return { family: 'morph' };

  return undefined;
};

const map: Record<string, R> = {};
const pairs = new Map<string, number>();
let derived = 0;
for (const id of ids) {
  const r = derive(id);
  if (!r) continue;
  derived++;
  map[id] = r;
  const key = `${r.family} :: ${r.generation ?? '—'}`;
  pairs.set(key, (pairs.get(key) || 0) + 1);
}

console.log(`derived ${derived}/${ids.length}`);
for (const [k, n] of [...pairs.entries()].sort()) console.log(String(n).padStart(4), k);

if (process.argv.includes('--emit')) {
  writeFileSync('/tmp/family-map.json', JSON.stringify(map, null, 1));
  console.log('\nwritten /tmp/family-map.json');
}
