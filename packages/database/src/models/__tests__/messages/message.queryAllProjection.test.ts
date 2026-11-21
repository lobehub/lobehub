// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messagePlugins, messages, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'query-all-projection-user';
const otherUserId = 'query-all-projection-other';
const messageModel = new MessageModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

// Focused regression suite for the `queryAll` tool-call projection (full
// creator-facing dump feeding `lh message list --json` and the wiki-ingest
// image-evidence verification). Kept out of the oversized
// `message.query.test.ts` suite per AGENTS.md: files over 1200 lines must
// not grow.
describe('MessageModel queryAll — tool-call plugin projection', () => {
  it('projects tool-call plugin fields for tool messages', async () => {
    // Regression: tool-call metadata lives on the 1:1 message_plugins row;
    // without the join, `tool_call_id` / `plugin` / `pluginState` were always
    // absent and wiki-ingest image evidence could never match an
    // analyzeMedia result to its originating call.
    await serverDB.insert(messages).values([
      {
        id: 'q-plugin-tool',
        userId,
        role: 'tool',
        content: 'IMAGE_READ_OK 1:abc\nanalysis text',
      },
      { id: 'q-plugin-user', userId, role: 'user', content: 'plain question' },
    ]);
    await serverDB.insert(messagePlugins).values({
      id: 'q-plugin-tool',
      apiName: 'analyzeMedia',
      arguments: JSON.stringify({ question: 'describe', urls: ['https://r2.example/a.png'] }),
      identifier: 'lobe-agent',
      state: { model: 'gemini-vision', success: true },
      toolCallId: 'call_123',
      type: 'default',
      userId,
    });

    const result = await messageModel.queryAll();
    const toolRow = result.find((m) => m.id === 'q-plugin-tool') as any;
    const userRow = result.find((m) => m.id === 'q-plugin-user') as any;

    expect(toolRow.tool_call_id).toBe('call_123');
    expect(toolRow.plugin.identifier).toBe('lobe-agent');
    expect(toolRow.plugin.apiName).toBe('analyzeMedia');
    expect(JSON.parse(toolRow.plugin.arguments).urls).toEqual(['https://r2.example/a.png']);
    expect(toolRow.pluginState.model).toBe('gemini-vision');
    expect(toolRow.pluginState.success).toBe(true);
    // Non-tool rows have no plugin row: drizzle nullifies the whole nested
    // object when every joined column is null (see queryByIds sender note).
    expect(userRow.tool_call_id).toBeNull();
    expect(userRow.plugin).toBeNull();
  });

  it('isolates plugin fields by ownership', async () => {
    await serverDB.insert(messages).values({
      id: 'q-other-tool',
      userId: otherUserId,
      role: 'tool',
      content: 'foreign tool output',
    });
    await serverDB.insert(messagePlugins).values({
      id: 'q-other-tool',
      apiName: 'analyzeMedia',
      identifier: 'lobe-agent',
      state: { model: 'gemini-vision' },
      toolCallId: 'call_other',
      userId: otherUserId,
    });

    const result = await messageModel.queryAll();

    expect(result).toHaveLength(0);
  });

  it('redacts inline base64 data URLs from exported plugin arguments', async () => {
    // `lh message list --json` prints rows verbatim; inline media payloads
    // reach several MB per URL, so the projection must keep the attribution
    // (mime header) without dumping the base64 body.
    const bigBody = 'A'.repeat(200_000);
    await serverDB.insert(messages).values({
      id: 'q-redact-tool',
      userId,
      role: 'tool',
      content: 'vision result',
    });
    await serverDB.insert(messagePlugins).values({
      id: 'q-redact-tool',
      apiName: 'analyzeMedia',
      arguments: JSON.stringify({
        question: 'describe',
        urls: [`data:image/png;base64,${bigBody}`],
      }),
      identifier: 'lobe-agent',
      toolCallId: 'call_redact',
      userId,
    });

    const result = await messageModel.queryAll();
    const row = result.find((m) => m.id === 'q-redact-tool') as any;
    const args = JSON.parse(row.plugin.arguments);

    expect(args.urls[0]).toBe('data:image/png;base64,...redacted...');
    expect(row.plugin.arguments.length).toBeLessThan(500);
    expect(row.tool_call_id).toBe('call_redact');
  });

  it('redacts inline base64 data URLs nested inside pluginState', async () => {
    // Same export path as the arguments redaction: browser-tool screenshots
    // persist as `state.dataUrl` (packages/builtin-tool-browser client
    // executor) and reach this projection unchanged, so a multi-MB base64
    // body would again serialize verbatim into `lh message list --json`.
    const bigBody = 'B'.repeat(200_000);
    await serverDB.insert(messages).values({
      id: 'q-redact-state',
      userId,
      role: 'tool',
      content: 'screenshot captured',
    });
    await serverDB.insert(messagePlugins).values({
      id: 'q-redact-state',
      apiName: 'screenshot',
      arguments: JSON.stringify({ fullPage: false }),
      identifier: 'lobe-browser',
      state: {
        dataUrl: `data:image/jpeg;base64,${bigBody}`,
        size: { width: 1280, height: 720 },
        success: true,
      },
      toolCallId: 'call_redact_state',
      userId,
    });

    const result = await messageModel.queryAll();
    const row = result.find((m) => m.id === 'q-redact-state') as any;
    const state = row.pluginState as {
      dataUrl: string;
      size: { width: number; height: number };
      success: boolean;
    };

    // The data-URL body is redacted while the surrounding state survives:
    expect(state.dataUrl).toBe('data:image/jpeg;base64,...redacted...');
    expect(state.size).toEqual({ width: 1280, height: 720 });
    expect(state.success).toBe(true);
    expect(row.tool_call_id).toBe('call_redact_state');
  });

  it('redacts parameterized and case-varied data URLs from arguments and state', async () => {
    // The ingestion side (builtin-tool-lobe-agent media.ts) accepts
    // /^data:(?:audio|image|video)\//i URLs up to 2,000,000 chars, so the
    // redaction predicate must be case-insensitive and parameter-aware —
    // `;charset=utf-8`-style media-type parameters must not bypass it.
    const bigBody = 'C'.repeat(200_000);
    await serverDB.insert(messages).values({
      id: 'q-redact-variants',
      userId,
      role: 'tool',
      content: 'variant media result',
    });
    await serverDB.insert(messagePlugins).values({
      id: 'q-redact-variants',
      apiName: 'analyzeMedia',
      arguments: JSON.stringify({
        refs: [`DATA:IMAGE/PNG;charset=utf-8;base64,${bigBody}`],
        urls: [`data:Video/MP4;charset=utf-8;base64,${bigBody}`],
      }),
      identifier: 'lobe-agent',
      state: { dataUrl: `data:image/jpeg;charset=utf-8;base64,${bigBody}` },
      toolCallId: 'call_redact_variants',
      userId,
    });

    const result = await messageModel.queryAll();
    const row = result.find((m) => m.id === 'q-redact-variants') as any;
    const args = JSON.parse(row.plugin.arguments);
    const state = row.pluginState as { dataUrl: string };

    expect(args.refs[0]).toBe('DATA:IMAGE/PNG;charset=utf-8;base64,...redacted...');
    expect(args.urls[0]).toBe('data:Video/MP4;charset=utf-8;base64,...redacted...');
    expect(row.plugin.arguments.length).toBeLessThan(600);
    expect(state.dataUrl).toBe('data:image/jpeg;charset=utf-8;base64,...redacted...');
    expect(row.tool_call_id).toBe('call_redact_variants');
  });

  it('projects partial plugin rows that have no apiName', async () => {
    // Drizzle nullifies a left-joined nested selection from its first
    // selected column (see queryWithWhere sender note). Partial plugin rows
    // without api_name are a supported shape (write.ts persists
    // `plugin?.apiName`), so the projection anchors presence on the non-null
    // PK `id` instead of the nullable `apiName`.
    await serverDB.insert(messages).values({
      id: 'q-partial-plugin',
      userId,
      role: 'tool',
      content: 'partial plugin row',
    });
    await serverDB.insert(messagePlugins).values({
      id: 'q-partial-plugin',
      arguments: JSON.stringify({ ok: true }),
      identifier: 'lobe-agent',
      toolCallId: 'call_partial',
      userId,
      // no apiName, no type (defaulted server-side? type defaults to
      // 'default' at the column level, so pass type: null is not possible —
      // omit instead)
    });

    const result = await messageModel.queryAll();
    const row = result.find((m) => m.id === 'q-partial-plugin') as any;

    expect(row.plugin).not.toBeNull();
    expect(row.plugin.id).toBe('q-partial-plugin');
    expect(row.plugin.apiName).toBeNull();
    expect(JSON.parse(row.plugin.arguments).ok).toBe(true);
    expect(row.plugin.identifier).toBe('lobe-agent');
    expect(row.tool_call_id).toBe('call_partial');
  });

  it('redacts JSON-escaped line-wrapped data URL bodies', async () => {
    // JSON serialization represents line breaks as literal `\n` two-char
    // sequences; without matching backslashes the body class stops at the
    // first escape and leaks the wrapped remainder through the CLI dump.
    const wrappedBody = ('E'.repeat(70) + '\n').repeat(3000); // ~210KB with breaks
    await serverDB.insert(messages).values({
      id: 'q-redact-wrapped',
      userId,
      role: 'tool',
      content: 'wrapped payload',
    });
    await serverDB.insert(messagePlugins).values({
      id: 'q-redact-wrapped',
      apiName: 'analyzeMedia',
      arguments: JSON.stringify({ urls: [`data:image/png;base64,${wrappedBody}`] }),
      identifier: 'lobe-agent',
      toolCallId: 'call_redact_wrapped',
      userId,
    });

    const result = await messageModel.queryAll();
    const row = result.find((m) => m.id === 'q-redact-wrapped') as any;
    const args = JSON.parse(row.plugin.arguments);

    expect(args.urls[0]).toBe('data:image/png;base64,...redacted...');
    expect(row.plugin.arguments.length).toBeLessThan(500);
    expect(row.tool_call_id).toBe('call_redact_wrapped');
  });

  it('redacts data URLs inside JSON-escaped strings without corrupting the JSON', async () => {
    // An embedded escaped quote after the payload (HTML `src=\"data:...\"`)
    // must not be consumed by the body class: a bare-backslash class eats
    // the `\` of `\"`, leaves the quote dangling, and the `::jsonb` cast of
    // the redacted state text then fails the whole queryAll.
    const bigBody = 'F'.repeat(200_000);
    const html = `<img src=\\"data:image/png;base64,${bigBody}\\" alt=\\"shot\\">`;
    await serverDB.insert(messages).values({
      id: 'q-redact-escaped-quote',
      userId,
      role: 'tool',
      content: 'escaped quote payload',
    });
    await serverDB.insert(messagePlugins).values({
      id: 'q-redact-escaped-quote',
      apiName: 'screenshot',
      identifier: 'lobe-browser',
      state: { html },
      toolCallId: 'call_redact_quote',
      userId,
    });

    const result = await messageModel.queryAll();
    const row = result.find((m) => m.id === 'q-redact-escaped-quote') as any;
    const state = row.pluginState as { html: string };

    // payload redacted, escaped quotes preserved, state still valid JSON:
    expect(state.html).toBe(
      '<img src=\\"data:image/png;base64,...redacted...\\" alt=\\"shot\\">',
    );
    expect(row.tool_call_id).toBe('call_redact_quote');
  });

  it('redacts exotic MIME tokens and percent-encoded base64 bodies', async () => {
    // RFC 2045 token grammar allows `~`/`_`/`'` in MIME types and the
    // validator accepts the result; percent escapes inside the body
    // (`%2B`) must not terminate the match either.
    const bigBody = `%2B${'G'.repeat(199_990)}`;
    await serverDB.insert(messages).values({
      id: 'q-redact-exotic',
      userId,
      role: 'tool',
      content: 'exotic mime payload',
    });
    await serverDB.insert(messagePlugins).values({
      id: 'q-redact-exotic',
      apiName: 'analyzeMedia',
      arguments: JSON.stringify({ urls: [`data:audio/x.foo~bar;base64,${bigBody}`] }),
      identifier: 'lobe-agent',
      toolCallId: 'call_redact_exotic',
      userId,
    });

    const result = await messageModel.queryAll();
    const row = result.find((m) => m.id === 'q-redact-exotic') as any;
    const args = JSON.parse(row.plugin.arguments);

    expect(args.urls[0]).toBe('data:audio/x.foo~bar;base64,...redacted...');
    expect(row.plugin.arguments.length).toBeLessThan(500);
    expect(row.tool_call_id).toBe('call_redact_exotic');
  });

  it('redacts non-base64 percent-encoded media data URLs', async () => {
    // The ingestion validator accepts /^data:(?:audio|image|video)\//i URLs
    // without requiring ;base64, — an SVG payload rides in raw
    // percent-encoded form and would serialize verbatim into the CLI dump.
    const bigBody = '%3Csvg%20'.repeat(25_000) + '%3C/svg%3E'; // ~200KB encoded
    await serverDB.insert(messages).values({
      id: 'q-redact-svg',
      userId,
      role: 'tool',
      content: 'svg payload',
    });
    await serverDB.insert(messagePlugins).values({
      id: 'q-redact-svg',
      apiName: 'analyzeMedia',
      arguments: JSON.stringify({ urls: [`data:image/svg+xml,${bigBody}`] }),
      identifier: 'lobe-agent',
      toolCallId: 'call_redact_svg',
      userId,
    });

    const result = await messageModel.queryAll();
    const row = result.find((m) => m.id === 'q-redact-svg') as any;
    const args = JSON.parse(row.plugin.arguments);

    expect(args.urls[0]).toBe('data:image/svg+xml,...redacted...');
    expect(row.plugin.arguments.length).toBeLessThan(500);
    expect(row.tool_call_id).toBe('call_redact_svg');
  });

  it('redacts raw SVG markup data URLs through the JSON-string boundary', async () => {
    // Non-base64 forms also arrive as raw markup (`data:image/svg+xml,<svg
    // ...>`); `<`/`>` are excluded from the base64/percent alphabet, so the
    // raw branch must carry the redaction through the JSON-string boundary
    // instead of stopping at the first angle bracket.
    const bigBody = `<svg xmlns='http://www.w3.org/2000/svg'>${'<rect width=1 height=1 />'.repeat(11_000)}</svg>`;
    await serverDB.insert(messages).values({
      id: 'q-redact-raw-svg',
      userId,
      role: 'tool',
      content: 'raw svg payload',
    });
    await serverDB.insert(messagePlugins).values({
      id: 'q-redact-raw-svg',
      apiName: 'analyzeMedia',
      arguments: JSON.stringify({ urls: [`data:image/svg+xml,${bigBody}`] }),
      identifier: 'lobe-agent',
      toolCallId: 'call_redact_raw_svg',
      userId,
    });

    const result = await messageModel.queryAll();
    const row = result.find((m) => m.id === 'q-redact-raw-svg') as any;
    const args = JSON.parse(row.plugin.arguments);

    expect(args.urls[0]).toBe('data:image/svg+xml,...redacted...');
    expect(row.plugin.arguments.length).toBeLessThan(500);
    expect(row.tool_call_id).toBe('call_redact_raw_svg');
  });

  it('does not rewrite plain long strings that merely start with data:mime', async () => {
    // `(?:;base64,)?` once made the comma optional, so documentation text
    // after `data:image/png` matched the body alphabet and got rewritten
    // even though it is not a data URL. The comma separator is required for
    // both forms; a near-miss string must survive verbatim.
    const nearMiss =
      'data:image/png followed by documentation text that runs long enough to exceed the ' +
      'sixty-four character body threshold of the redaction predicate...';
    await serverDB.insert(messages).values({
      id: 'q-near-miss',
      userId,
      role: 'tool',
      content: 'near miss payload',
    });
    await serverDB.insert(messagePlugins).values({
      id: 'q-near-miss',
      apiName: 'docs',
      arguments: JSON.stringify({ note: nearMiss }),
      identifier: 'lobe-agent',
      toolCallId: 'call_near_miss',
      userId,
    });

    const result = await messageModel.queryAll();
    const row = result.find((m) => m.id === 'q-near-miss') as any;
    const args = JSON.parse(row.plugin.arguments);

    expect(args.note).toBe(nearMiss);
    expect(row.tool_call_id).toBe('call_near_miss');
  });

  it('preserves the string suffix after a base64 URL with a long non-base64 tail', async () => {
    // The generic-parameter loop once absorbed a bare `;base64` (no comma)
    // as a media-type parameter, so the raw pass re-matched an
    // already-redacted base64 URL: its `(?!;base64)` was evaluated at the
    // comma after the absorbed parameter and succeeded, and the raw body
    // then consumed the escaped closing quote plus the whole suffix through
    // the outer JSON boundary — silently truncating exported content. The
    // parameter loop now refuses `;base64,` so the raw pass cannot
    // re-match base64 URLs and the suffix survives verbatim.
    const suffix = `<svg xmlns='x'>${'Z'.repeat(300)}</svg>`;
    const note = `data:image/png;base64,${'B'.repeat(200_000)}${suffix}`;
    await serverDB.insert(messages).values({
      id: 'q-redact-base64-suffix',
      userId,
      role: 'tool',
      content: 'base64 suffix payload',
    });
    await serverDB.insert(messagePlugins).values({
      id: 'q-redact-base64-suffix',
      apiName: 'analyzeMedia',
      arguments: JSON.stringify({ note }),
      identifier: 'lobe-agent',
      toolCallId: 'call_redact_base64_suffix',
      userId,
    });

    const result = await messageModel.queryAll();
    const row = result.find((m) => m.id === 'q-redact-base64-suffix') as any;
    const args = JSON.parse(row.plugin.arguments);

    expect(args.note).toBe(`data:image/png;base64,...redacted...${suffix}`);
    expect(row.plugin.arguments.length).toBeLessThan(500);
    expect(row.tool_call_id).toBe('call_redact_base64_suffix');
  });

  it('preserves the HTML suffix after a raw SVG data URL embedded in an attribute', async () => {
    // The raw body class once treated the attribute-closing escaped quote
    // as payload (`\\.` consumed `\"`) and kept matching through
    // ` alt=\"shot\" width=\"2\">}` to the outer JSON boundary — the JSONB
    // cast still succeeded but the export silently lost everything after
    // the URL. The raw body now stops at escaped-quote delimiters: `\"`
    // ends the embedded string instead of riding along as payload.
    const bigSvg = `<svg xmlns='http://www.w3.org/2000/svg'>${'<rect width=1 height=1 />'.repeat(11_000)}</svg>`;
    const html = `<img src=\\"data:image/svg+xml,${bigSvg}\\" alt=\\"shot\\" width=\\"2\\">`;
    await serverDB.insert(messages).values({
      id: 'q-redact-raw-html-suffix',
      userId,
      role: 'tool',
      content: 'raw html suffix payload',
    });
    await serverDB.insert(messagePlugins).values({
      id: 'q-redact-raw-html-suffix',
      apiName: 'screenshot',
      identifier: 'lobe-browser',
      state: { html },
      toolCallId: 'call_redact_raw_html_suffix',
      userId,
    });

    const result = await messageModel.queryAll();
    const row = result.find((m) => m.id === 'q-redact-raw-html-suffix') as any;
    const state = row.pluginState as { html: string };

    expect(state.html).toBe(
      `<img src=\\"data:image/svg+xml,...redacted...\\" alt=\\"shot\\" width=\\"2\\">`,
    );
    expect(row.tool_call_id).toBe('call_redact_raw_html_suffix');
  });

  it('redacts base64url data-URL bodies (URL-safe alphabet)', async () => {
    // Ingestion (builtin-tool-lobe-agent media.ts) accepts any parseable
    // `data:audio|image|video` URL without validating the body encoding, so
    // URL-safe base64 (`-`/`_`) bodies are a supported persisted form. The
    // body alphabet once lacked `-`/`_`, so a base64url body (or any mixed
    // payload with an unsupported character) leaked entirely — or leaked
    // everything after the first unsupported character — through the CLI
    // dump (Codex round-8 P2).
    const bigBody = `${'-_'.repeat(100_000)}-_`;
    await serverDB.insert(messages).values({
      id: 'q-redact-base64url',
      userId,
      role: 'tool',
      content: 'base64url payload',
    });
    await serverDB.insert(messagePlugins).values({
      id: 'q-redact-base64url',
      apiName: 'analyzeMedia',
      arguments: JSON.stringify({ urls: [`data:video/mp4;base64,${bigBody}`] }),
      identifier: 'lobe-agent',
      toolCallId: 'call_redact_base64url',
      userId,
    });

    const result = await messageModel.queryAll();
    const row = result.find((m) => m.id === 'q-redact-base64url') as any;
    const args = JSON.parse(row.plugin.arguments);

    expect(args.urls[0]).toBe('data:video/mp4;base64,...redacted...');
    expect(row.plugin.arguments.length).toBeLessThan(500);
    expect(row.tool_call_id).toBe('call_redact_base64url');
  });

  it('fails closed on quote-containing raw payloads: redacts through the JSON boundary', async () => {
    // When a raw payload itself contains escaped quotes (double-quoted SVG
    // attributes are the common case), the primary raw pass dies on the
    // first embedded `\"` and the fallback pass deliberately redacts through
    // the outer JSON boundary, truncating the string's suffix beyond the
    // URL. That is an accepted fail-closed trade-off: a distinguishing
    // heuristic (first quote, space-following quote, attribute-following
    // quote...) would be a leak vector for megabyte payloads — the storage
    // rows keep the full data, only this creator-facing export projection
    // truncates, and the attribution header survives. Codex round-8 P2:
    // documented with this regression so the truncation cannot regress to a
    // leak.
    const bigSvg = `<svg xmlns=\\"http://www.w3.org/2000/svg\\">${'<rect width=1 height=1 />'.repeat(11_000)}</svg>`;
    const html = `<img src=\\"data:image/svg+xml,${bigSvg}\\" alt=\\"shot\\">`;
    await serverDB.insert(messages).values({
      id: 'q-redact-quote-payload',
      userId,
      role: 'tool',
      content: 'quote payload',
    });
    await serverDB.insert(messagePlugins).values({
      id: 'q-redact-quote-payload',
      apiName: 'screenshot',
      identifier: 'lobe-browser',
      state: { html },
      toolCallId: 'call_redact_quote_payload',
      userId,
    });

    const result = await messageModel.queryAll();
    const row = result.find((m) => m.id === 'q-redact-quote-payload') as any;
    const state = row.pluginState as { html: string };

    // The data-URL header is redacted; because the payload contains escaped
    // quotes the fallback pass redacts through the JSON-string boundary and
    // the suffix beyond the URL is dropped (fail-closed). The critical
    // guarantees: NO payload bytes leak and the column stays valid JSONB.
    expect(state.html.startsWith('<img src=\\"data:image/svg+xml,...redacted...')).toBe(true);
    expect(state.html).not.toContain('<rect');
    expect(state.html.length).toBeLessThan(500);
    expect(() => JSON.stringify(state)).not.toThrow();
    expect(row.tool_call_id).toBe('call_redact_quote_payload');
  });

  it('redacts payloads behind a base64-prefixed non-sentinel parameter', async () => {
    // Codex round-9 P2: the mime-parameter lookahead once excluded any
    // parameter whose name merely STARTED with `base64` (`;base64url=x`).
    // Ingestion accepts such a URL, but with the parameter stuck outside the
    // header none of the three redaction passes could reach the comma and
    // the full payload leaked. Only the exact `;base64,` sentinel marks the
    // encoding; `base64*` parameters are ordinary mime parameters.
    const bigBody = 'x'.repeat(100_000);
    await serverDB.insert(messages).values({
      id: 'q-redact-base64-param',
      userId,
      role: 'tool',
      content: 'base64-prefixed param payload',
    });
    await serverDB.insert(messagePlugins).values({
      id: 'q-redact-base64-param',
      apiName: 'analyzeMedia',
      arguments: JSON.stringify({
        urls: [`data:video/mp4;base64url=x,${bigBody}`],
      }),
      identifier: 'lobe-agent',
      toolCallId: 'call_redact_base64_param',
      userId,
    });

    const result = await messageModel.queryAll();
    const row = result.find((m) => m.id === 'q-redact-base64-param') as any;
    const args = JSON.parse(row.plugin.arguments);

    expect(args.urls[0]).toBe('data:video/mp4;base64url=x,...redacted...');
    expect(row.plugin.arguments.length).toBeLessThan(500);
    expect(row.plugin.arguments).not.toContain(bigBody);
    expect(row.tool_call_id).toBe('call_redact_base64_param');
  });
});
