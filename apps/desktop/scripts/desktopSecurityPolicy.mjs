import { createHash, createPublicKey, sign } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { parseXml } from 'builder-util-runtime';
import { gte, satisfies, valid } from 'semver';
import { parse as parseYaml } from 'yaml';
import * as z from 'zod/v4';

import {
  securityUpdatePolicySchema,
  securityUpdateRuleSchema,
} from '../src/common/securityPolicy.ts';
import { canonicalJson, verifyManifestSignature } from '../src/common/signedJson.ts';

const KEY = 'security-policy.json';
const MAX_BYTES = 1024 * 1024;
const mutation = {
  apply: z.boolean().default(false),
  expectedRevision: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1),
  reason: z.string().trim().min(1).max(500),
};
export const securityPolicyRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('inspect') }),
  z.strictObject({ ...mutation, action: z.literal('mark'), rule: securityUpdateRuleSchema }),
  z.strictObject({
    ...mutation,
    action: z.literal('revoke'),
    ruleId: z.string().regex(/^[a-f0-9]{64}$/),
  }),
]);

const digest = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');
// Stable across a repair-minimum change, and independent of platform ordering.
export const ruleId = ({ affectedVersions, channel, platforms, target }) =>
  digest({ affectedVersions, channel, platforms: [...new Set(platforms)].sort(), target });
const describe = (policy) => ({
  revision: policy?.revision ?? 0,
  rules: (policy?.rules ?? []).map((rule) => ({ id: ruleId(rule), ...rule })),
});
const parsePolicy = (value, publicKey) => {
  const policy = securityUpdatePolicySchema.parse(value);
  if (!verifyManifestSignature(policy, publicKey))
    throw new Error('Security policy signature invalid');
  return policy;
};
const asUrl = (value) => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Expected an HTTP(S) URL without credentials');
  }
  return url;
};

async function readText(response) {
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${response.url}`);
  if (Number(response.headers.get('content-length')) > MAX_BYTES)
    throw new Error('Response too large');
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BYTES) {
      throw new Error('Response too large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
const fetchText = async (url, fetchImpl) =>
  readText(
    await fetchImpl(url.toString(), { cache: 'no-store', signal: AbortSignal.timeout(15_000) }),
  );

export function planSecurityPolicy(current, rawRequest) {
  const request = securityPolicyRequestSchema.parse(rawRequest);
  if (request.action === 'inspect') return { changed: false, policy: current, request };
  const revision = current?.revision ?? 0;
  if (revision !== request.expectedRevision) {
    throw new Error(
      `Policy changed: expected revision ${request.expectedRevision}, found ${revision}. Inspect before retrying.`,
    );
  }
  let rules = [...(current?.rules ?? [])];
  if (request.action === 'mark') {
    const rule = { ...request.rule, platforms: [...new Set(request.rule.platforms)].sort() };
    const id = ruleId(rule);
    const index = rules.findIndex((entry) => ruleId(entry) === id);
    if (index === -1) rules.push(rule);
    else rules[index] = rule;
  } else {
    if (!rules.some((entry) => ruleId(entry) === request.ruleId))
      throw new Error('Rule not found; inspect before revoking');
    rules = rules.filter((entry) => ruleId(entry) !== request.ruleId);
  }
  const changed = canonicalJson(rules) !== canonicalJson(current?.rules ?? []);
  const policy = {
    kind: 'desktop-security-policy',
    revision: revision + (changed ? 1 : 0),
    rules,
    schemaVersion: 1,
  };
  // Enforce client limits before any storage write, including the rule-count limit.
  securityUpdatePolicySchema.parse({ ...policy, signature: 'pending' });
  return { changed, policy, request };
}

/** Verify the same public feed clients use, including both supported macOS architectures. */
export async function verifyRepairInstallers({ policy, rule, feedBaseUrl, fetchImpl = fetch }) {
  const feedChannel = rule.channel === 'beta' ? 'canary' : rule.channel;
  const feed = new URL(`${feedChannel}/`, `${feedBaseUrl}/`);
  const relevant = policy.rules.filter((entry) => entry.channel === rule.channel);
  const checked = [];
  for (const platform of rule.platforms) {
    const feeds =
      platform === 'darwin'
        ? ['appcast-arm64.xml', 'appcast-x64.xml']
        : [platform === 'linux' ? `${feedChannel}-linux.yml` : `${feedChannel}.yml`];
    for (const filename of feeds) {
      const feedUrl = new URL(filename, feed);
      const raw = await fetchText(feedUrl, fetchImpl);
      let version;
      let urls;
      if (platform === 'darwin') {
        const item = parseXml(raw).element('channel').getElements('item')[0];
        if (!item) throw new Error(`Empty appcast: ${feedUrl}`);
        const enclosure = item.element('enclosure');
        version =
          item.elementValueOrEmpty('sparkle:shortVersionString') ||
          enclosure.attributes?.['sparkle:shortVersionString'];
        if (!enclosure.attributes?.['sparkle:edSignature'])
          throw new Error(`Unsigned Sparkle enclosure: ${feedUrl}`);
        urls = [enclosure.attribute('url')];
      } else {
        const manifest = parseYaml(raw, { maxAliasCount: 0 });
        version = manifest?.version;
        const extension = platform === 'linux' ? '.appimage' : '.exe';
        const files = manifest?.files?.filter(
          (file) => typeof file.url === 'string' && file.url.toLowerCase().endsWith(extension),
        );
        if (!files?.length || files.some((file) => !file.sha512))
          throw new Error(`No hashed installer in ${feedUrl}`);
        urls = files.map((file) => file.url);
      }
      if (
        !valid(version) ||
        relevant.some(
          (entry) =>
            entry.platforms.includes(platform) &&
            (!gte(version, entry.minimumInstallerVersion) ||
              satisfies(version, entry.affectedVersions, { includePrerelease: true })),
        )
      ) {
        throw new Error(
          `Installer ${version ?? '<unknown>'} in ${feedUrl} does not satisfy the security policy`,
        );
      }
      for (const value of urls) {
        const installer = asUrl(new URL(value, feed));
        if (installer.origin !== feed.origin || !installer.pathname.startsWith(feed.pathname)) {
          throw new Error(`Installer is outside the channel feed: ${installer}`);
        }
        const response = await fetchImpl(installer.toString(), {
          method: 'HEAD',
          cache: 'no-store',
          signal: AbortSignal.timeout(15_000),
        });
        if (
          !response.ok ||
          Number(response.headers.get('content-length')) <= 0 ||
          !response.headers.has('content-length')
        ) {
          throw new Error(`Installer unavailable: ${installer} (HTTP ${response.status})`);
        }
        checked.push({
          feed: feedUrl.toString(),
          installer: installer.toString(),
          platform,
          version,
        });
      }
    }
  }
  return checked;
}

export function createPolicyStore({ client, bucket }) {
  return {
    read: async () => {
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: KEY }));
        if (response.ContentLength > MAX_BYTES) throw new Error('Stored policy too large');
        const body = await readText(new Response(response.Body.transformToWebStream()));
        if (!response.ETag)
          throw new Error('Policy ETag missing; conditional publication unavailable');
        return { etag: response.ETag, policy: JSON.parse(body) };
      } catch (error) {
        if (error.name === 'NoSuchKey') return { etag: null, policy: null };
        throw error;
      }
    },
    archive: async (key, body) => {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: 'application/json',
            IfNoneMatch: '*',
          }),
        );
      } catch (error) {
        // Content-addressed history is write-once. A retry may already have archived these bytes.
        if (error.name !== 'PreconditionFailed') throw error;
        const existing = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if ((await readText(new Response(existing.Body.transformToWebStream()))) !== body) {
          throw new Error('Existing history object differs from the signed policy', {
            cause: error,
          });
        }
      }
    },
    write: async (body, etag) => {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: KEY,
          Body: body,
          ContentType: 'application/json',
          CacheControl: 'no-store, max-age=0',
          ...(etag ? { IfMatch: etag } : { IfNoneMatch: '*' }),
        }),
      );
    },
  };
}

export async function runSecurityPolicy({
  request: input,
  store,
  feedBaseUrl,
  publicKey,
  privateKey,
  fetchImpl = fetch,
  record = async () => {},
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const request = securityPolicyRequestSchema.parse(input);
  asUrl(feedBaseUrl);
  const stored = await store.read();
  const current = stored.policy ? parsePolicy(stored.policy, publicKey) : null;
  const plan = planSecurityPolicy(current, request);
  let result = {
    action: request.action,
    before: describe(current),
    after: describe(plan.policy),
    status: 'inspected',
  };
  if (request.action === 'inspect') {
    // A public-cache mismatch is visible even after a prior run wrote successfully but failed readback.
    let publicRevision = null;
    let publicError;
    try {
      const policy = parsePolicy(
        JSON.parse(await fetchText(`${feedBaseUrl}/${KEY}`, fetchImpl)),
        publicKey,
      );
      publicRevision = policy.revision;
      if (!current || canonicalJson(policy) !== canonicalJson(current))
        publicError = 'Public policy differs from storage';
    } catch (error) {
      publicError = error.message;
    }
    result = { ...result, publicRevision, publicError };
    await record(result);
    return result;
  }
  result = { ...result, reason: request.reason, status: plan.changed ? 'planned' : 'no-change' };
  await record(result);
  if (!plan.changed) return result;
  const installers =
    request.action === 'mark'
      ? await verifyRepairInstallers({
          policy: plan.policy,
          rule: request.rule,
          feedBaseUrl,
          fetchImpl,
        })
      : [];
  result = { ...result, installers, status: request.apply ? 'prepared' : 'preview' };
  await record(result);
  if (!request.apply) return result;
  if (!privateKey) throw new Error('RENDERER_OTA_PRIVATE_KEY is required to apply');
  const derived = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  if (!derived.equals(createPublicKey(publicKey).export({ format: 'der', type: 'spki' })))
    throw new Error('Signing key does not match the client public key');
  const policy = {
    ...plan.policy,
    signature: sign(null, Buffer.from(canonicalJson(plan.policy)), privateKey).toString('base64'),
  };
  parsePolicy(policy, publicKey);
  const body = JSON.stringify(policy, null, 2) + '\n';
  if (Buffer.byteLength(body) > MAX_BYTES) throw new Error('Policy exceeds client size limit');
  const archive = `security-policy-history/${policy.revision}-${digest(policy)}.json`;
  await store.archive(archive, body);
  await store.write(body, stored.etag);
  result = { ...result, archive, status: 'published-unverified' };
  await record(result);
  let failure;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const remote = parsePolicy(
        JSON.parse(await fetchText(`${feedBaseUrl}/${KEY}`, fetchImpl)),
        publicKey,
      );
      if (canonicalJson(remote) !== canonicalJson(policy))
        throw new Error('Public policy differs from the published policy');
      result = { ...result, status: 'verified', url: `${feedBaseUrl}/${KEY}` };
      await record(result);
      return result;
    } catch (error) {
      failure = error;
    }
    if (attempt < 2) await wait(2000);
  }
  throw new Error(
    `Policy was written but public verification failed: ${failure.message}. Inspect before retrying; do not republish blindly.`,
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      'request': { type: 'string' },
      'output': { type: 'string' },
      'validate-request': { type: 'boolean' },
    },
  });
  const input = values.request
    ? await readFile(values.request, 'utf8')
    : process.env.SECURITY_POLICY_REQUEST;
  if (!input) throw new Error('Provide --request <json-file> or SECURITY_POLICY_REQUEST');
  const required = (name) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
  const request = securityPolicyRequestSchema.parse(JSON.parse(input));
  if (values['validate-request']) {
    console.log(JSON.stringify(request));
    return;
  }
  const feedBaseUrl = required('UPDATE_SERVER_URL')
    .replace(/\/$/, '')
    .replace(/\/(stable|canary|beta|nightly)$/, '');
  const publicKey = required('RENDERER_OTA_PUBLIC_KEY');
  const client = new S3Client({
    region: process.env.UPDATE_S3_REGION || 'auto',
    endpoint: required('UPDATE_S3_ENDPOINT'),
    credentials: {
      accessKeyId: required('UPDATE_AWS_ACCESS_KEY_ID'),
      secretAccessKey: required('UPDATE_AWS_SECRET_ACCESS_KEY'),
    },
    maxAttempts: 1,
  });
  let report;
  const record = async (state) => {
    report = {
      ...state,
      actor: process.env.GITHUB_ACTOR,
      runUrl: process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : undefined,
    };
    if (values.output) {
      await mkdir(path.dirname(values.output), { recursive: true });
      await writeFile(values.output, JSON.stringify(report, null, 2) + '\n');
    }
  };
  try {
    await runSecurityPolicy({
      request,
      store: createPolicyStore({ client, bucket: required('UPDATE_S3_BUCKET') }),
      feedBaseUrl,
      publicKey,
      privateKey: process.env.RENDERER_OTA_PRIVATE_KEY,
      record,
    });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await record({ ...report, error: error.message, status: report?.status ?? 'failed' });
    throw error;
  } finally {
    client.destroy();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
