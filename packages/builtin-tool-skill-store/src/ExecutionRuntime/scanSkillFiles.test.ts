import { describe, expect, it } from 'vitest';

import { isCredentialName, scanSkillFiles } from './scanSkillFiles';

// Excerpts of OpenSenseNova/SenseNova-Skills `sn-da-image-caption`: its description says
// "无需额外配置 API Key", while the body and the script need a SenseNova key and post the
// image to SenseNova's API.
const captionSkillMd = `# Image Caption Analysis

## scripts/caption.py — Image Caption

The script converts images to text descriptions via a vision model. Configure via \`SN_API_KEY\` (minimum required), or use \`SN_VISION_API_KEY\` / \`SN_VISION_BASE_URL\` / \`SN_VISION_MODEL\` for fine-grained control.
`;

const captionPy = `#!/usr/bin/env python3
"""
- API key and model are pre-configured, no setup needed
"""
import os

# Fallback chain: SN_VISION_* → SN_CHAT_* → SN_* → built-in default
_BUILTIN_BASE_URL = "https://token.sensenova.cn/v1"
_BUILTIN_MODEL = "sensenova-6.8-flash-lite"

DEFAULT_API_KEY = (
    os.environ.get("SN_VISION_API_KEY")
    or os.environ.get("SN_CHAT_API_KEY")
    or os.environ.get("SN_API_KEY")
    or ""
)
DEFAULT_API_BASE = (
    os.environ.get("SN_VISION_BASE_URL")
    or os.environ.get("SN_CHAT_BASE_URL")
    or os.environ.get("SN_BASE_URL")
    or _BUILTIN_BASE_URL
)
DEFAULT_MODEL = os.environ.get("SN_VISION_MODEL") or os.environ.get("SN_CHAT_MODEL") or _BUILTIN_MODEL

def call(client, b64):
    return client.chat.completions.create(
        model=DEFAULT_MODEL,
        messages=[{"role": "user", "content": [
            {"type": "text", "text": "describe"},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
        ]}],
    )
CACHE_DIR = os.path.join(os.environ.get("HOME"), ".caption_cache")
`;

describe('scanSkillFiles', () => {
  it('reports the vendor key and host a "no API key needed" skill actually uses', () => {
    const result = scanSkillFiles([
      { content: captionSkillMd, path: 'SKILL.md' },
      { content: captionPy, path: 'scripts/caption.py' },
    ]);

    expect(result.requiresApiKey).toBe(true);
    expect(result.apiKeyNames).toEqual(['SN_API_KEY', 'SN_CHAT_API_KEY', 'SN_VISION_API_KEY']);
    expect(result.credentials).toEqual([
      {
        alternatives: ['SN_VISION_API_KEY', 'SN_CHAT_API_KEY'],
        defaultValue: null,
        files: ['SKILL.md', 'scripts/caption.py'],
        hasDefault: false,
        name: 'SN_API_KEY',
        requirement: 'one_of',
      },
      {
        alternatives: ['SN_VISION_API_KEY', 'SN_API_KEY'],
        defaultValue: null,
        files: ['scripts/caption.py'],
        hasDefault: false,
        name: 'SN_CHAT_API_KEY',
        requirement: 'one_of',
      },
      {
        alternatives: ['SN_CHAT_API_KEY', 'SN_API_KEY'],
        defaultValue: null,
        files: ['SKILL.md', 'scripts/caption.py'],
        hasDefault: false,
        name: 'SN_VISION_API_KEY',
        requirement: 'one_of',
      },
    ]);
    expect(
      result.settings.map(({ defaultValue, name, requirement }) => [
        name,
        requirement,
        defaultValue,
      ]),
    ).toEqual([
      ['SN_BASE_URL', 'optional', 'https://token.sensenova.cn/v1'],
      ['SN_CHAT_BASE_URL', 'optional', 'https://token.sensenova.cn/v1'],
      ['SN_CHAT_MODEL', 'optional', 'sensenova-6.8-flash-lite'],
      ['SN_VISION_BASE_URL', 'optional', 'https://token.sensenova.cn/v1'],
      ['SN_VISION_MODEL', 'optional', 'sensenova-6.8-flash-lite'],
    ]);
    expect(result.endpoints).toEqual([
      { files: ['scripts/caption.py'], host: 'token.sensenova.cn' },
    ]);
    expect(result.dataEgress).toEqual({
      configurableVia: ['SN_BASE_URL', 'SN_CHAT_BASE_URL', 'SN_VISION_BASE_URL'],
      contentTypes: ['image', 'text'],
      occurs: true,
      signals: [
        { contentType: 'image', file: 'scripts/caption.py', signal: 'image_url' },
        { contentType: 'text', file: 'scripts/caption.py', signal: 'messages=' },
      ],
      targets: ['token.sensenova.cn'],
    });
    expect(result.scripts).toEqual(['scripts/caption.py']);
  });

  it('reads Node, Deno, Go and Ruby environment access', () => {
    const result = scanSkillFiles([
      {
        content: `const key = process.env.OPENAI_API_KEY;\nconst t = process.env['GH_TOKEN'];\nconst m = process.env.MODEL_NAME;`,
        path: 'scripts/run.mjs',
      },
      { content: `const s = Deno.env.get("STRIPE_SECRET_KEY");`, path: 'scripts/pay.ts' },
      { content: `key := os.Getenv("ANTHROPIC_API_KEY")`, path: 'tool/main.go' },
      { content: `token = ENV.fetch("SLACK_BOT_TOKEN")`, path: 'bin/notify.rb' },
    ]);

    expect(result.credentials.map((c) => c.name)).toEqual([
      'ANTHROPIC_API_KEY',
      'GH_TOKEN',
      'OPENAI_API_KEY',
      'SLACK_BOT_TOKEN',
      'STRIPE_SECRET_KEY',
    ]);
    expect(result.settings.map((s) => s.name)).toEqual(['MODEL_NAME']);
  });

  it('keeps only credential-like variables from shell scripts, docs and dotenv files', () => {
    const result = scanSkillFiles([
      {
        content: `#!/bin/bash\ncd "$HOME/$1"\ncurl -H "Authorization: Bearer $NOTION_TOKEN" "$BASE_URL/pages"`,
        path: 'scripts/sync.sh',
      },
      { content: 'Set `REPLICATE_API_TOKEN`. Output goes to `OUTPUT_DIR`.', path: 'README.md' },
      { content: 'ELEVENLABS_API_KEY=\nVOICE_ID=abc\n', path: '.env.example' },
    ]);

    expect(result.credentials.map((c) => c.name)).toEqual([
      'ELEVENLABS_API_KEY',
      'NOTION_TOKEN',
      'REPLICATE_API_TOKEN',
    ]);
    expect(result.settings).toEqual([]);
  });

  it('does not count doc links, comments, loopback or XML namespaces as hosts', () => {
    const result = scanSkillFiles([
      { content: 'Docs: https://platform.openai.com/docs', path: 'SKILL.md' },
      {
        content: [
          '# See https://github.com/owner/repo for details',
          '// https://docs.example.dev/api',
          'NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
          'SVG = "http://www.w3.org/2000/svg"',
          'LOCAL = "http://localhost:8080/v1"',
          'LOOP = "http://127.0.0.1:3000"',
          'API = "https://api.Replicate.com/v1/predictions"',
        ].join('\n'),
        path: 'scripts/build.py',
      },
    ]);

    expect(result.endpoints).toEqual([{ files: ['scripts/build.py'], host: 'api.replicate.com' }]);
  });

  it('reports a docs-only skill as needing nothing', () => {
    const result = scanSkillFiles([
      { content: 'Write release notes from the git log.', path: 'SKILL.md' },
      { content: 'A template with `{{VERSION}}`.', path: 'references/template.md' },
    ]);

    expect(result).toEqual({
      apiKeyNames: [],
      credentials: [],
      dataEgress: {
        configurableVia: [],
        contentTypes: [],
        occurs: false,
        signals: [],
        targets: [],
      },
      endpoints: [],
      requiresApiKey: false,
      scripts: [],
      settings: [],
    });
  });

  it('tells required, optional and unknown reads apart across languages', () => {
    const { credentials, settings } = scanSkillFiles([
      {
        content: [
          'a = os.environ["STRICT_API_KEY"]',
          'b = os.getenv("SOFT_API_KEY")',
          'c = os.getenv("REGION", "us-east-1")',
          'd = os.environ.get("EMPTY_DEFAULT", "")',
          'os.environ["ONLY_WRITTEN"] = "1"',
        ].join('\n'),
        path: 'scripts/a.py',
      },
      {
        content:
          'const m = process.env.MODEL_NAME || "gpt-x";\nconst k = process.env.A_TOKEN ?? process.env.B_TOKEN;',
        path: 'scripts/b.mjs',
      },
      {
        content: 'x = ENV.fetch("RUBY_TOKEN")\ny = ENV.fetch("RUBY_MODE", "fast")',
        path: 'bin/c.rb',
      },
      {
        content: 'curl "${API_URL:-https://u:p@api.acme.io}" -H "x: ${SHELL_TOKEN:?unset}"',
        path: 's/d.sh',
      },
    ]);
    const need = Object.fromEntries(
      [...credentials, ...settings].map((v) => [v.name, [v.requirement, v.defaultValue]]),
    );

    expect(need).toEqual({
      API_URL: ['optional', 'https://[redacted]@api.acme.io'],
      A_TOKEN: ['one_of', null],
      B_TOKEN: ['one_of', null],
      EMPTY_DEFAULT: ['unknown', null],
      MODEL_NAME: ['optional', 'gpt-x'],
      REGION: ['optional', 'us-east-1'],
      RUBY_MODE: ['optional', 'fast'],
      RUBY_TOKEN: ['required', null],
      SHELL_TOKEN: ['required', null],
      SOFT_API_KEY: ['unknown', null],
      STRICT_API_KEY: ['required', null],
    });
  });

  it('does not treat a read or a call passed as the default as a guaranteed value', () => {
    const { credentials, requiresApiKey } = scanSkillFiles([
      {
        content: [
          'a = os.getenv("A_API_KEY", os.getenv("B_API_KEY"))',
          'c = os.getenv("C_API_KEY", load_key())',
          'd = os.getenv("D_TOKEN", os.getenv("E_TOKEN", "fallback-token"))',
          'f = os.getenv("F_TOKEN", os.environ["G_TOKEN"])',
        ].join('\n'),
        path: 'scripts/a.py',
      },
    ]);
    const need = Object.fromEntries(
      credentials.map((c) => [c.name, [c.requirement, c.alternatives, c.defaultValue]]),
    );

    expect(requiresApiKey).toBe(true);
    expect(need).toEqual({
      A_API_KEY: ['one_of', ['B_API_KEY'], null],
      B_API_KEY: ['one_of', ['A_API_KEY'], null],
      C_API_KEY: ['unknown', [], null],
      D_TOKEN: ['optional', [], '[redacted]'],
      E_TOKEN: ['optional', [], '[redacted]'],
      // The argument runs first, so G_TOKEN raises even when F_TOKEN is set.
      F_TOKEN: ['unknown', [], null],
      G_TOKEN: ['required', [], null],
    });
  });

  it('does not call a variable optional when its default may be empty', () => {
    const result = scanSkillFiles([
      {
        content: [
          'DEFAULT_KEY = None',
          'a = os.getenv("VENDOR_API_KEY", DEFAULT_KEY)',
          'b = os.getenv("IMPORTED_URL", settings.BASE)',
          'c = os.getenv("SAMPLE_API_KEY", "your-api-key-here")',
          'd = os.getenv("KNOWN_URL") or os.getenv("OTHER_URL", UNSET) or "https://api.acme.io"',
        ].join('\n'),
        path: 'scripts/a.py',
      },
      { content: 'curl "${SHELL_URL:-$FALLBACK_URL}"', path: 'scripts/b.sh' },
    ]);
    const need = Object.fromEntries(
      [...result.credentials, ...result.settings].map((v) => [
        v.name,
        [v.requirement, v.hasDefault, v.defaultValue],
      ]),
    );

    expect(result.requiresApiKey).toBe(true);
    expect(need).toEqual({
      IMPORTED_URL: ['unknown', false, null],
      KNOWN_URL: ['optional', true, 'https://api.acme.io'],
      OTHER_URL: ['optional', true, 'https://api.acme.io'],
      SAMPLE_API_KEY: ['unknown', false, null],
      SHELL_URL: ['unknown', false, null],
      VENDOR_API_KEY: ['unknown', false, null],
    });
  });

  it('does not merge different fallback groups into "any one is enough"', () => {
    const { credentials, requiresApiKey } = scanSkillFiles([
      {
        content: [
          'x = os.getenv("A_API_KEY") or os.getenv("B_API_KEY")',
          'y = os.getenv("A_API_KEY") or os.getenv("C_API_KEY")',
          'p = os.getenv("P_TOKEN") or os.getenv("Q_TOKEN")',
          'q = os.getenv("Q_TOKEN") or os.getenv("P_TOKEN")',
        ].join('\n'),
        path: 'scripts/a.py',
      },
    ]);
    const need = Object.fromEntries(
      credentials.map((c) => [c.name, [c.requirement, c.alternatives]]),
    );

    expect(requiresApiKey).toBe(true);
    expect(need).toEqual({
      A_API_KEY: ['unknown', []],
      B_API_KEY: ['unknown', []],
      C_API_KEY: ['unknown', []],
      // The same group read in another order is still one group.
      P_TOKEN: ['one_of', ['Q_TOKEN']],
      Q_TOKEN: ['one_of', ['P_TOKEN']],
    });
  });

  it('keeps a read with no default from being satisfied by another read', () => {
    const { credentials, requiresApiKey, settings } = scanSkillFiles([
      {
        content:
          'k = os.getenv("VENDOR_API_KEY", "preview-public-key")\nu = os.getenv("REGION", "eu")',
        path: 'scripts/preview.py',
      },
      {
        content: [
          'k = os.getenv("VENDOR_API_KEY")',
          'u = os.getenv("REGION", "us")',
          'a = os.getenv("A_TOKEN") or os.getenv("B_TOKEN")',
          'b = os.getenv("A_TOKEN")',
          'c = os.getenv("C_TOKEN") or os.getenv("D_TOKEN")',
          'd = os.environ["C_TOKEN"]',
        ].join('\n'),
        path: 'scripts/upload.py',
      },
    ]);
    const need = Object.fromEntries(
      [...credentials, ...settings].map((v) => [v.name, [v.requirement, v.hasDefault]]),
    );

    expect(requiresApiKey).toBe(true);
    expect(need).toEqual({
      A_TOKEN: ['unknown', false],
      B_TOKEN: ['unknown', false],
      C_TOKEN: ['required', false],
      D_TOKEN: ['unknown', false],
      REGION: ['optional', true],
      VENDOR_API_KEY: ['unknown', false],
    });
  });

  it('keeps a strict read required when it comes first in a chain', () => {
    const { credentials, settings } = scanSkillFiles([
      {
        content: [
          'a = os.environ["A_API_KEY"] or os.environ["B_API_KEY"]',
          'c = os.getenv("C_API_KEY") or os.environ["D_API_KEY"] or os.getenv("E_API_KEY")',
          'm = os.environ["STRICT_MODEL"] or "fallback-model"',
        ].join('\n'),
        path: 'scripts/a.py',
      },
    ]);
    const need = Object.fromEntries(
      [...credentials, ...settings].map((v) => [
        v.name,
        [v.requirement, v.alternatives, v.defaultValue],
      ]),
    );

    expect(need).toEqual({
      A_API_KEY: ['required', [], null],
      B_API_KEY: ['unknown', [], null],
      C_API_KEY: ['one_of', ['D_API_KEY'], null],
      D_API_KEY: ['one_of', ['C_API_KEY'], null],
      E_API_KEY: ['unknown', [], null],
      STRICT_MODEL: ['required', [], null],
    });
  });

  it('never passes on a credential default', () => {
    const result = scanSkillFiles([
      { content: 'KEY = os.getenv("VENDOR_API_KEY", "sk-live-abc123")', path: 'scripts/a.py' },
    ]);

    expect(result.credentials[0]).toMatchObject({
      defaultValue: '[redacted]',
      hasDefault: true,
      requirement: 'optional',
    });
    expect(result.requiresApiKey).toBe(false);
    expect(result.apiKeyNames).toEqual(['VENDOR_API_KEY']);
    expect(JSON.stringify(result)).not.toContain('sk-live');
  });

  it('uses the docs only where the code leaves a credential open', () => {
    const result = scanSkillFiles([
      {
        content:
          'No `OPENAI_API_KEY` needed. `HF_TOKEN` is required.\nDo not commit your `GH_TOKEN`.',
        path: 'NOTES.md',
      },
      { content: 'You do not need `ACME_API_KEY`.', path: 'SKILL.md' },
      { content: 'k = os.environ["ACME_API_KEY"]', path: 'scripts/a.py' },
    ]);
    const need = Object.fromEntries(result.credentials.map((c) => [c.name, c.requirement]));

    expect(need).toEqual({
      ACME_API_KEY: 'required',
      GH_TOKEN: 'unknown',
      HF_TOKEN: 'required',
      OPENAI_API_KEY: 'optional',
    });
    expect(result.requiresApiKey).toBe(true);
  });

  it('reports what a script sends, and unknown when it cannot tell', () => {
    const upload = scanSkillFiles([
      {
        content: 'requests.post("https://api.acme.io/v1", files={"f": fh}, data=meta)',
        path: 'scripts/up.py',
      },
    ]);
    const opaque = scanSkillFiles([
      { content: 'send(os.environ["SINK_ENDPOINT"], blob)', path: 'scripts/sink.py' },
    ]);

    expect(upload.dataEgress).toMatchObject({
      contentTypes: ['file'],
      occurs: true,
      targets: ['api.acme.io'],
    });
    expect(opaque.dataEgress).toEqual({
      configurableVia: ['SINK_ENDPOINT'],
      contentTypes: ['unknown'],
      occurs: true,
      signals: [],
      targets: [],
    });
  });

  it('counts an HTTP call to a URL built at run time as data leaving', () => {
    const { dataEgress } = scanSkillFiles([
      {
        content: 'url = build_url()\nrequests.post(url, json={"prompt": text})',
        path: 'scripts/send.py',
      },
      { content: 'print(open("notes.txt").read())', path: 'scripts/local.py' },
    ]);

    expect(dataEgress).toEqual({
      configurableVia: [],
      contentTypes: ['text'],
      occurs: true,
      signals: [{ contentType: 'text', file: 'scripts/send.py', signal: '"prompt":' }],
      targets: [],
    });
  });

  it('lists but does not read binary or oversized files', () => {
    const result = scanSkillFiles([
      { content: 'os.environ.get("FAKE_API_KEY")\0\0', path: 'scripts/blob.py' },
      {
        content: `x = os.environ.get("BIG_TOKEN")\n${'#'.repeat(600 * 1024)}`,
        path: 'scripts/big.py',
      },
    ]);

    expect(result.scripts).toEqual(['scripts/big.py', 'scripts/blob.py']);
    expect(result.credentials).toEqual([]);
  });
});

describe('isCredentialName', () => {
  it.each([
    'SN_API_KEY',
    'OPENAI_APIKEY',
    'AWS_ACCESS_KEY_ID',
    'GH_TOKEN',
    'DB_PASSWORD',
    'GITHUB_PAT',
  ])('treats %s as a credential', (name) => expect(isCredentialName(name)).toBe(true));

  it.each(['SN_VISION_BASE_URL', 'SN_VISION_MODEL', 'OUTPUT_DIR', 'IMAGE_PATH', 'MAX_TOKENS'])(
    'treats %s as a setting',
    (name) => expect(isCredentialName(name)).toBe(false),
  );
});
