import type { EnvironmentConfiguration } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { environmentInstances, environments } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

/** Canonical GitHub source only; credentials and arbitrary clone transports are never persisted. */
export const normalizeProjectRepository = (value: string): string => {
  const ssh = /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/.exec(value.trim());
  const url = new URL(ssh ? `https://github.com/${ssh[1]}` : value.trim());
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Use a GitHub repository URL without credentials');
  const path = url.pathname.replace(/\/$/, '').replace(/\.git$/, '');
  if (!/^\/[\w.-]+\/[\w.-]+$/.test(path)) throw new Error('Use a GitHub repository URL');
  return `https://github.com${path}`;
};

/**
 * Single-aggregate access to abstract environments and their materialized
 * instances. Cross-table flows (e.g. binding a project directory, which
 * upserts environment + instance + project link in one transaction) live in
 * `repositories/projectDirectory` and compose this model with a tx handle.
 */
export class EnvironmentModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private scope() {
    return { userId: this.userId, workspaceId: this.workspaceId };
  }

  /** Enabled environments visible in the current workspace scope. */
  async list() {
    return this.db
      .select({
        id: environments.id,
        name: environments.name,
        configuration: environments.configuration,
      })
      .from(environments)
      .where(and(buildWorkspaceWhere(this.scope(), environments), eq(environments.enabled, true)));
  }

  /** Enabled, workspace-visible lookup used when linking projects or binding directories. */
  async findEnabledById(id: string) {
    const [row] = await this.db
      .select()
      .from(environments)
      .where(
        and(
          eq(environments.id, id),
          buildWorkspaceWhere(this.scope(), environments),
          eq(environments.enabled, true),
        ),
      );
    return row;
  }

  async save(input: { id?: string; name: string; repositoryUrl?: string }) {
    const source = input.repositoryUrl?.trim();
    const configuration: EnvironmentConfiguration = source
      ? { sources: [{ kind: 'git', url: normalizeProjectRepository(source) }] }
      : {};
    if (input.id) {
      const [existing] = await this.db
        .select()
        .from(environments)
        .where(
          and(
            eq(environments.id, input.id),
            buildWorkspaceWhere(this.scope(), environments),
            eq(environments.userId, this.userId),
          ),
        );
      if (!existing) throw new Error('Environment not found or access denied');
      const [row] = await this.db
        .update(environments)
        .set({
          name: input.name.trim(),
          configuration: { ...existing.configuration, sources: configuration.sources ?? [] },
          updatedAt: new Date(),
        })
        .where(eq(environments.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await this.db
      .insert(environments)
      .values({
        name: input.name.trim(),
        configuration,
        userId: this.userId,
        workspaceId: this.workspaceId,
      })
      .returning();
    return row;
  }

  /** Device instances are unique per (device, workingDirectory) — see the schema constraint. */
  async findDeviceInstance(deviceId: string, workingDirectory: string) {
    const [row] = await this.db
      .select()
      .from(environmentInstances)
      .where(
        and(
          eq(environmentInstances.deviceId, deviceId),
          eq(environmentInstances.workingDirectory, workingDirectory),
        ),
      );
    return row;
  }

  async createDeviceInstance(input: {
    configurationSnapshot: EnvironmentConfiguration;
    deviceId: string;
    environmentId: string;
    name: string;
    workingDirectory: string;
  }) {
    const [row] = await this.db
      .insert(environmentInstances)
      .values({ ...input, kind: 'device' })
      .returning();
    return row;
  }
}
