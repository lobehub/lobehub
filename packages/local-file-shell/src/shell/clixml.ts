/**
 * Decode PowerShell CLIXML blocks embedded in redirected stderr.
 *
 * When powershell.exe / pwsh.exe runs with redirected stderr, records from its
 * non-stdout streams (error, warning, verbose, information / Write-Host) are
 * serialized to stderr as CLIXML: `#< CLIXML\n<Objs ...>...</Objs>`. Shown
 * verbatim this is unreadable noise for the model and the user, so we extract
 * the human-readable messages and replace each block in place — the same
 * approach Ansible's `_parse_clixml` takes.
 */

const CLIXML_MARKER = '#< CLIXML';

/** CLIXML escapes characters as `_xHHHH_` (UTF-16 code units). */
const unescapeClixmlText = (text: string): string =>
  text
    .replaceAll(/_x([\dA-Fa-f]{4})_/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');

/** Stream-typed string records: `<S S="Error">text</S>` (PS 5.1 style). */
const STREAM_ENTRY = /<S S="(?:Error|Warning|Verbose|Debug|Info)">([\S\s]*?)<\/S>/g;

/**
 * Rendered text of serialized records (`InformationRecord` / `HostInformationMessage`
 * from Write-Host end up here). Nested objects repeat the same message in their
 * own `<ToString>`, so consecutive duplicates are collapsed by the caller.
 */
const TO_STRING_ENTRY = /<ToString>([\S\s]*?)<\/ToString>/g;

const extractBlockMessages = (block: string): string[] => {
  const streamTexts = [...block.matchAll(STREAM_ENTRY)].map((m) => m[1]);
  // Prefer explicit stream entries; fall back to record ToString renderings
  // (information records carry no stream-typed <S> entries).
  const texts =
    streamTexts.length > 0 ? streamTexts : [...block.matchAll(TO_STRING_ENTRY)].map((m) => m[1]);

  const messages: string[] = [];
  for (const raw of texts) {
    const text = unescapeClixmlText(raw);
    if (messages.at(-1) === text) continue;
    messages.push(text);
  }
  return messages;
};

/**
 * Replace every CLIXML block in `text` with its decoded messages. Plain text
 * around the blocks is preserved; input without a marker is returned as-is.
 * Truncated blocks (output preview cuts) decode whatever entries survived.
 */
export const decodeClixml = (text: string): string => {
  if (!text.includes(CLIXML_MARKER)) return text;

  let result = '';
  let cursor = 0;
  while (cursor < text.length) {
    const markerIndex = text.indexOf(CLIXML_MARKER, cursor);
    if (markerIndex === -1) {
      result += text.slice(cursor);
      break;
    }

    result += text.slice(cursor, markerIndex);

    const closeTag = '</Objs>';
    const closeIndex = text.indexOf(closeTag, markerIndex);
    const blockEnd = closeIndex === -1 ? text.length : closeIndex + closeTag.length;
    const block = text.slice(markerIndex, blockEnd);

    const messages = extractBlockMessages(block);
    if (messages.length > 0) {
      // Error-stream texts carry their own trailing newlines (`_x000D__x000A_`);
      // ToString renderings do not — normalize so messages never run together.
      result += messages.map((m) => (m.endsWith('\n') ? m : `${m}\n`)).join('');
    }

    cursor = blockEnd;
  }

  return result;
};
