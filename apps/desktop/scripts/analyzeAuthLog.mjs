import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const LINE_RE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\] \[(\w+)\]\s+\[([^\]]+)\] (.*)$/;

const MATCHERS = [
  { kind: 'appStart', re: /^\s*OS: (.+)$/, summary: (m) => `app started (${m[1]})` },
  {
    kind: 'authResponse',
    re: /auth response (proxy:.*)$/,
    summary: (m) => m[1],
    fields: (m) => parseReason(m[1]),
  },
  {
    kind: 'authRequired',
    re: /Broadcasting authorizationRequired(?: event)? \(reason=(.*)\)$/,
    summary: (m) => m[1],
    fields: (m) => parseReason(m[1]),
  },
  {
    kind: 'streamAuthResponse',
    re: /\[(?:ForwardStream|StreamProxy) [^\]]+\]\[[^\]]+\] auth response (status=.*)$/,
    summary: (m) => m[1],
    fields: (m) => parseReason(m[1]),
  },
  {
    kind: 'decryptFailed',
    re: /Failed to decrypt (access|refresh) token/,
    summary: (m) => `${m[1]} token decrypt failed`,
  },
  {
    kind: 'safeStorageUnavailable',
    re: /Safe storage not available/,
    summary: () => 'safeStorage unavailable',
  },
  {
    kind: 'refreshFailed',
    re: /(?:Token refresh failed|Auto-refresh failed after retries|Proactive token refresh failed|Token refresh failed via AuthCtr call|Exception during token refresh operation): (.*)$/,
    summary: (m) => m[1].trim(),
  },
  {
    kind: 'refreshFailed',
    re: /No refresh token available/,
    summary: () => 'no refresh token in storage',
  },
  {
    kind: 'refreshOk',
    re: /(Token refresh successful|Auto-refresh successful|Proactive token refresh successful)/,
    summary: (m) => m[1],
  },
  {
    kind: 'refreshTriggered',
    re: /(Token is expiring soon.*|Token is expired or expiring soon.*|Initiating new token refresh operation)/,
    summary: (m) => m[1],
  },
  {
    kind: 'timerStarted',
    re: /Token is valid, starting auto-refresh timer\. Token expires at: (.*)$/,
    summary: (m) => `auto-refresh timer armed, exp ${m[1]}`,
  },
  {
    kind: 'tokensSaved',
    re: /(Successfully saved exchanged tokens|Authorization successful)/,
    summary: (m) => m[1],
  },
  {
    kind: 'tokensCleared',
    re: /Clearing (access and refresh tokens|remote server configuration)/,
    summary: (m) => `cleared ${m[1]}`,
  },
  {
    kind: 'loginStarted',
    re: /Requesting OAuth authorization, storageMode:(\S+) server URL: (\S+)/,
    summary: (m) => `login started (${m[1]} ${m[2]})`,
  },
];

function parseReason(reason) {
  const fields = {};
  const status = reason.match(/status=(\d+)/);
  if (status) fields.status = Number(status[1]);
  const hadToken = reason.match(/hadToken=(true|false)/);
  if (hadToken) fields.hadToken = hadToken[1] === 'true';
  const authRequired = reason.match(/authRequired=(true|false)/);
  if (authRequired) fields.authRequired = authRequired[1] === 'true';
  const authFailure = reason.match(/authFailure=(\S+)/);
  if (authFailure) fields.authFailure = authFailure[1];
  const route = reason.match(/\b(GET|POST|PUT|DELETE|PATCH) (\S+)/);
  if (route) fields.route = `${route[1]} ${route[2]}`;
  const expiredBy = reason.match(/expiredBy=(\d+)s/);
  if (expiredBy) fields.expiredBySeconds = Number(expiredBy[1]);
  const expiresIn = reason.match(/expiresIn=(\d+)s/);
  if (expiresIn) fields.expiresInSeconds = Number(expiresIn[1]);
  const tag = reason.match(/^((?:refresh|auto-refresh|startup|activate)\S*)/);
  if (tag) fields.tag = tag[1];
  const body = reason.match(/body=(.*)$/);
  if (body) fields.body = body[1];
  return fields;
}

export function parseAuthEvents(text) {
  const events = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.match(LINE_RE);
    if (!line) continue;
    const [, timestamp, level, namespace, message] = line;
    for (const matcher of MATCHERS) {
      const m = message.match(matcher.re);
      if (!m) continue;
      events.push({
        fields: matcher.fields ? matcher.fields(m) : {},
        kind: matcher.kind,
        level,
        namespace,
        summary: matcher.summary(m),
        timestamp,
      });
      break;
    }
  }
  return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

const VERDICTS = {
  HEADER_DROPPED_IN_TRANSIT: {
    next: 'Desktop injected Oidc-Auth but the server saw none. Check the user’s proxy / VPN / corporate gateway stripping custom headers, or a remote URL that redirects (headers are dropped on cross-origin redirect).',
    title: 'Token sent, server received no token',
  },
  NON_SESSION_401: {
    next: 'Not a login problem. Read the body: provider API key, market OAuth, or a workspace permission. Route the ticket to that feature.',
    title: '401 without X-Auth-Required',
  },
  NO_AUTH_EVENTS: {
    next: 'Ask for both main.log and main.old.log from the logs directory (Help > Open Logs Directory), and confirm the 401 happened in the desktop app rather than a browser tab.',
    title: 'No auth events in this log',
  },
  NO_TOKEN_STORED: {
    next: 'No token was ever saved in this session and no decrypt error. Check whether login completed (look for "Successfully saved exchanged tokens") or whether the store file was removed.',
    title: 'Request went out without a token',
  },
  REFRESH_TOKEN_REVOKED: {
    next: 'The refresh token was rotated away or revoked (another device, crash between rotation and save, or server-side revoke). Re-login is the only fix; check for a second device/session if it recurs.',
    title: 'Refresh rejected by server',
  },
  SAFE_STORAGE_DECRYPT_FAILED: {
    next: 'macOS Keychain / Windows DPAPI could not decrypt the stored token (new signing identity, keychain reset, or profile migration). Re-login is required; if it recurs on every launch, the keychain entry for the app is denied.',
    title: 'Stored token could not be decrypted',
  },
  SERVER_KEY_MISMATCH: {
    next: 'The token signature does not match the server JWKS. Either the server rotated its key or the desktop is pointed at a different server than it logged in to. Compare the login server URL against the current remote URL.',
    title: 'Server rejected token signature',
  },
  SERVER_REJECTED_UNKNOWN: {
    next: 'This build predates X-Auth-Failure so the server reason is unknown. Ask the user to update and reproduce, or search server logs for "OIDC authentication failed" near this timestamp.',
    title: 'Server rejected a token, reason not logged',
  },
  TOKEN_EXPIRED_NOT_REFRESHED: {
    next: 'Access token expired before the auto-refresh ran (sleep/wake, timer lost, or app not running). Check the gap between the last "timer armed" and this 401; the refresh cycle should recover on next launch.',
    title: 'Expired token used, refresh did not run',
  },
  USER_INACTIVE: {
    next: 'The account is banned or deleted on the server. Nothing to fix client-side.',
    title: 'Account inactive on server',
  },
};

const lastBefore = (events, index, kinds) => {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (kinds.includes(events[i].kind)) return events[i];
  }
  return undefined;
};

function classify(events, index) {
  const event = events[index];
  const { authFailure, authRequired, hadToken, expiredBySeconds } = event.fields;

  if (hadToken === false) {
    if (lastBefore(events, index, ['decryptFailed'])) return 'SAFE_STORAGE_DECRYPT_FAILED';
    const cleared = lastBefore(events, index, ['tokensCleared', 'tokensSaved']);
    if (cleared?.kind === 'tokensCleared') {
      const refreshFailed = lastBefore(events, index, ['refreshFailed']);
      return refreshFailed ? 'REFRESH_TOKEN_REVOKED' : 'NO_TOKEN_STORED';
    }
    return 'NO_TOKEN_STORED';
  }

  if (authRequired === false) return 'NON_SESSION_401';
  if (authFailure === 'jwt_expired' || (!authFailure && expiredBySeconds !== undefined))
    return 'TOKEN_EXPIRED_NOT_REFRESHED';
  if (authFailure === 'jwt_signature' || authFailure === 'jwks_error') return 'SERVER_KEY_MISMATCH';
  if (authFailure === 'user_inactive') return 'USER_INACTIVE';
  if (authFailure === 'no_token') return 'HEADER_DROPPED_IN_TRANSIT';
  if (hadToken === true) return 'SERVER_REJECTED_UNKNOWN';
  return undefined;
}

export function analyzeAuthLog(text) {
  const events = parseAuthEvents(text);
  const verdicts = new Map();
  const record = (code, event) => {
    if (!verdicts.has(code))
      verdicts.set(code, { code, count: 0, first: event, ...VERDICTS[code] });
    const verdict = verdicts.get(code);
    verdict.count += 1;
    verdict.last = event;
  };

  events.forEach((event, index) => {
    if (['authResponse', 'authRequired', 'streamAuthResponse'].includes(event.kind)) {
      if (event.fields.tag) return;
      const code = classify(events, index);
      if (code) record(code, event);
      return;
    }
    if (
      event.kind === 'refreshFailed' &&
      /invalid_grant|grant request is invalid|400/.test(event.summary)
    ) {
      record('REFRESH_TOKEN_REVOKED', event);
    }
    if (event.kind === 'decryptFailed') record('SAFE_STORAGE_DECRYPT_FAILED', event);
  });

  if (verdicts.size === 0) {
    record('NO_AUTH_EVENTS', events[0]);
  }

  return { events, verdicts: [...verdicts.values()] };
}

export function formatReport({ events, verdicts }, { limit = 80 } = {}) {
  const lines = ['== Verdicts =='];
  for (const v of verdicts) {
    lines.push(
      `* ${v.code} (${v.count}x)${v.first ? ` first at ${v.first.timestamp}` : ''}: ${v.title}`,
    );
    lines.push(`  next: ${v.next}`);
  }
  const shown = limit > 0 ? events.slice(-limit) : events;
  lines.push(
    '',
    `== Auth timeline (last ${shown.length} of ${events.length} events; --all for everything) ==`,
  );
  for (const e of shown) {
    lines.push(`${e.timestamp} [${e.level}] ${e.kind.padEnd(22)} ${e.summary}`);
  }
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const all = args.includes('--all');
  const files = args.filter((a) => !a.startsWith('--'));
  if (files.length === 0) {
    console.error(
      'usage: node scripts/analyzeAuthLog.mjs [--json] [--all] <main.log> [main.old.log ...]',
    );
    process.exit(1);
  }
  const text = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  const result = analyzeAuthLog(text);
  console.log(
    json ? JSON.stringify(result, null, 2) : formatReport(result, { limit: all ? 0 : 80 }),
  );
}
