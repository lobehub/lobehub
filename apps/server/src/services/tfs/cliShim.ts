const quote = (value: string) => `'${value.replaceAll("'", String.raw`'\''`)}'`;

// Shipped with the server so self-hosted TFS runs do not depend on an npm CLI release.
const script = String.raw`
(async () => {
  const args = process.argv.slice(1);
  const operation = args.shift();
  if (!['fetch', 'pull', 'push'].includes(operation)) throw new Error('Expected fetch, pull or push');
  const options = {};
  while (args.length) {
    const key = args.shift();
    if (!['--topic', '--source', '--branch'].includes(key) || !args.length) throw new Error('Invalid TFS Git arguments');
    options[key] = args.shift();
  }
  const token = process.env.LOBEHUB_JWT;
  const server = process.env.LOBEHUB_SERVER;
  if (!token || !server) throw new Error('LobeHub execution authentication is unavailable');
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  const bound = claims.purpose === 'hetero-operation';
  if (bound && options['--topic'] && options['--topic'] !== process.env.LOBEHUB_TOPIC_ID)
    throw new Error('An operation can only access its own conversation');
  const source = options['--source'] || '0';
  if (!/^\d{1,2}$/.test(source)) throw new Error('Invalid Git source index');
  const input = { operation, sourceIndex: Number(source) };
  if (options['--branch']) input.branch = options['--branch'];
  if (!bound) {
    input.topicId = options['--topic'] || process.env.LOBEHUB_TOPIC_ID;
    if (!input.topicId) throw new Error('Specify --topic for the cloud working directory');
  }
  const headers = { 'Content-Type': 'application/json', 'Oidc-Auth': token };
  if (process.env.LOBEHUB_WORKSPACE_ID) headers['X-Workspace-Id'] = process.env.LOBEHUB_WORKSPACE_ID;
  const response = await fetch(server.replace(/\/$/, '') + '/trpc/lambda/tfs.' + (bound ? 'gitOperation' : 'git'), {
    method: 'POST', headers, body: JSON.stringify({ json: input }), signal: AbortSignal.timeout(150000),
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error?.json?.message || 'TFS Git request failed');
  const result = body.result?.data?.json;
  if (!result || typeof result.success !== 'boolean') throw new Error('Invalid TFS Git response');
  console.log(JSON.stringify(result));
  if (!result.success) process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
`;

/** Goes inside the existing credentialed lh wrapper, before its unchanged CLI fallback. */
export const buildTfsCliDispatch = (envAssignments = '') =>
  [
    'if [ "$1" = tfs ] && [ "$2" = git ]; then',
    '  shift 2',
    `  ${envAssignments} exec node -e ${quote(script)} -- "$@"`,
    'fi',
  ].join('\n');

/** A no-secret wrapper inherited by the cloud CLI and every process it launches. */
export const withTfsCloudCli = (command: string) =>
  [
    '(',
    'export LOBE_TFS_ORIGINAL_LH="$(command -v lh)"',
    '__lobe_tfs_cli=$(mktemp -d) || exit 1',
    'trap \'rm -rf "$__lobe_tfs_cli"\' EXIT',
    'cat > "$__lobe_tfs_cli/lh" <<\'LOBE_TFS_CLI\'',
    '#!/bin/sh',
    buildTfsCliDispatch(),
    'exec "$LOBE_TFS_ORIGINAL_LH" "$@"',
    'LOBE_TFS_CLI',
    'chmod 700 "$__lobe_tfs_cli/lh" || exit 1',
    'export PATH="$__lobe_tfs_cli:$PATH"',
    command,
    ')',
  ].join('\n');
