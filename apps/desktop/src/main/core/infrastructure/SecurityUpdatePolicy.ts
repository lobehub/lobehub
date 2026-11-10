import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { readBlobWithLimit } from '@lobechat/utils/imageToBase64';
import { gte, satisfies, valid } from 'semver';

import { createLogger } from '@/utils/logger';
import { type SecurityPolicy, securityUpdatePolicySchema } from '~common/securityPolicy';

import { verifyManifestSignature } from './coreOta/manifest';

const logger = createLogger('core:SecurityUpdatePolicy');
interface Options {
  channel: string;
  coreVersion: () => string | null;
  feedBaseUrl: string;
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  platform: 'darwin' | 'linux' | 'win32';
  publicKey: string;
  shellVersion: string;
  userData: string;
}

/** Independent of OTA availability, rollout and the user's automatic-update preference. */
export class SecurityUpdatePolicy {
  private policy: SecurityPolicy | undefined;
  private readonly cacheFile: string;

  constructor(private readonly options: Options) {
    this.cacheFile = path.join(options.userData, 'security-update-policy.json');
  }

  private parse(value: unknown) {
    const policy = securityUpdatePolicySchema.parse(value);
    if (!verifyManifestSignature(policy, this.options.publicKey)) {
      throw new Error('Security policy signature invalid');
    }
    return policy;
  }

  check = async (): Promise<boolean> => {
    const { feedBaseUrl, fetchImpl, publicKey } = this.options;
    if (!publicKey || !feedBaseUrl) return false;
    if (!this.policy) {
      try {
        this.policy = this.parse(JSON.parse(await readFile(this.cacheFile, 'utf8')));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.warn('Cannot load cached security policy', error);
        }
      }
    }
    try {
      const response = await fetchImpl(`${feedBaseUrl}/security-policy.json`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`Security policy fetch failed: ${response.status}`);
      const next = this.parse(
        JSON.parse(await (await readBlobWithLimit(response, 1024 * 1024)).text()),
      );
      // Only a newer signed policy can revoke or change a known restriction.
      if (!this.policy || next.revision > this.policy.revision) {
        this.policy = next;
        await mkdir(path.dirname(this.cacheFile), { recursive: true });
        await writeFile(`${this.cacheFile}.tmp`, JSON.stringify(next));
        await rename(`${this.cacheFile}.tmp`, this.cacheFile);
      }
    } catch (error) {
      // A missing/unreachable policy must not lock out unaffected installations.
      // Once a signed restriction is known, the cached policy still enforces it offline.
      logger.warn('Security policy refresh failed; retaining last verified policy', error);
    }
    return this.affectedRules.length > 0;
  };

  private get applicableRules() {
    return (this.policy?.rules ?? []).filter(
      (rule) =>
        rule.channel === this.options.channel && rule.platforms.includes(this.options.platform),
    );
  }

  private get affectedRules() {
    return this.applicableRules.filter((rule) => {
      const version =
        rule.target === 'shell' ? this.options.shellVersion : this.options.coreVersion();
      return (
        version &&
        valid(version) &&
        satisfies(version, rule.affectedVersions, { includePrerelease: true })
      );
    });
  }

  isInstallerSafe = (version: string): boolean => {
    if (!valid(version)) return false;
    return (
      this.affectedRules.every((rule) => gte(version, rule.minimumInstallerVersion)) &&
      this.applicableRules.every(
        (rule) => !satisfies(version, rule.affectedVersions, { includePrerelease: true }),
      )
    );
  };
}
