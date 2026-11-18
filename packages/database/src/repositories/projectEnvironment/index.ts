import type { EnvironmentConfiguration, EnvironmentSource } from '@lobechat/types';
import { DEFAULT_REGENERABLE_PATHS, layoutRepositorySources } from '@lobechat/types';
import { and, asc, desc, eq, inArray, ne, notExists } from 'drizzle-orm';

import { ProjectModel } from '../../models/project';
import {
  environmentInstances,
  type EnvironmentItem,
  environments,
  projectEnvironments,
  projects,
  projectWorkingDirectories,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';

/** The project columns its environment is derived from. */
export interface ProjectEnvironmentOwner {
  id: string;
  name: string;
  userId: string;
  visibility: string;
  workspaceId: string | null;
}

/** What a project's environment may change from the project's settings. */
export interface ProjectEnvironmentPatch {
  configuration?: EnvironmentConfiguration;
  description?: string | null;
}

/**
 * Who sees a project's environment follows the project: in a workspace-public
 * project every member's conversation checks it out, so it is published with
 * it; anything else stays private to its creator. A personal row has no other
 * state.
 */
export const projectEnvironmentVisibility = (project: ProjectEnvironmentOwner) =>
  project.workspaceId && project.visibility === 'public' ? 'public' : 'private';

const gitSources = (configuration: EnvironmentConfiguration | null | undefined) =>
  (configuration?.sources ?? []).filter(
    (source): source is Extract<EnvironmentSource, { kind: 'git' }> => source.kind === 'git',
  );

/**
 * The repositories of `from` that `into` lacks, appended to it. A repository
 * already there (by url) is not added twice. Once there is more than one, they
 * are laid out side by side (see `layoutRepositorySources`).
 */
export const mergeRepositories = (
  into: EnvironmentConfiguration,
  from: (EnvironmentConfiguration | null | undefined)[],
): EnvironmentConfiguration => {
  const sources = [...(into.sources ?? [])];
  const known = new Set(gitSources(into).map((source) => source.url));
  for (const configuration of from) {
    for (const source of gitSources(configuration)) {
      if (known.has(source.url)) continue;
      known.add(source.url);
      sources.push(source);
    }
  }
  if (sources.length === (into.sources ?? []).length) return into;

  return { ...into, sources: layoutRepositorySources(sources) };
};

/**
 * Every project has exactly one environment, made with the project and edited
 * on the project's own settings: the repositories it checks out (any number,
 * or none), the setup that makes them usable, and the variables every command
 * sees. It is `environments.project_id`, linked by the project's single
 * `project_environments` row so that the directory and run paths that resolve
 * through that link keep working unchanged.
 *
 * A project from before this rule — several linked environments, one shared
 * with other projects, or none — is brought to it by {@link ensure}, the first
 * time anything asks for its environment, and by the backfill script for the
 * rest. Nothing is deleted on the way: an environment the project stops
 * linking stays in「设置 → 环境」, where it already was.
 */
export class ProjectEnvironmentRepository {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private projectModel() {
    return new ProjectModel(this.db, this.userId, this.workspaceId);
  }

  /** The environment of a project the caller can read. */
  async get(projectId: string): Promise<EnvironmentItem> {
    const project = await this.projectModel().findById(projectId);
    if (!project) throw new Error('Project not found or access denied');

    return ProjectEnvironmentRepository.ensure(this.db, project);
  }

  /**
   * Edits the environment of a project the caller can manage. Anyone who may
   * change the project may change its environment — it is part of the
   * project, not a row of its creator's that the project borrows — so the
   * write is scoped by the project rather than by the environment's owner.
   * The name follows the project and is not editable here.
   */
  async update(projectId: string, patch: ProjectEnvironmentPatch): Promise<EnvironmentItem> {
    const project = await this.projectModel().findManageableById(projectId);
    if (!project) throw new Error('Project not found or access denied');

    const environment = await ProjectEnvironmentRepository.ensure(this.db, project);
    const [row] = await this.db
      .update(environments)
      .set({
        ...(patch.configuration && {
          configuration: patch.configuration.sources
            ? {
                ...patch.configuration,
                sources: layoutRepositorySources(patch.configuration.sources),
              }
            : patch.configuration,
        }),
        ...(patch.description !== undefined && { description: patch.description }),
        updatedAt: new Date(),
      })
      .where(and(eq(environments.id, environment.id), eq(environments.projectId, project.id)))
      .returning();

    return row;
  }

  /**
   * Adds to the environment of a project the caller can manage the
   * repositories these definitions check out that it does not yet, laid out
   * side by side. What else they define is not taken.
   */
  async addRepositories(
    projectId: string,
    from: (EnvironmentConfiguration | null | undefined)[],
  ): Promise<EnvironmentItem> {
    const project = await this.projectModel().findManageableById(projectId);
    if (!project) throw new Error('Project not found or access denied');

    const environment = await ProjectEnvironmentRepository.ensure(this.db, project);
    const configuration = mergeRepositories(environment.configuration, from);
    if (configuration === environment.configuration) return environment;

    return this.update(projectId, { configuration });
  }

  /**
   * Makes a new project's environment, in the caller's transaction. It always
   * makes a new one: a project made from a repository checks that repository
   * out, any other starts with nothing to check out.
   */
  static async createForProject(
    db: LobeChatDatabase,
    project: ProjectEnvironmentOwner,
    configuration: EnvironmentConfiguration = {},
  ): Promise<EnvironmentItem> {
    const [environment] = await db
      .insert(environments)
      .values({
        configuration: {
          kind: 'code',
          ...configuration,
          excludePaths: configuration.excludePaths ?? [...DEFAULT_REGENERABLE_PATHS],
        },
        name: project.name,
        projectId: project.id,
        userId: project.userId,
        visibility: projectEnvironmentVisibility(project),
        workspaceId: project.workspaceId,
      })
      .returning();
    await db.insert(projectEnvironments).values({
      addedByUserId: project.userId,
      environmentId: environment.id,
      isDefault: true,
      projectId: project.id,
      workspaceId: project.workspaceId,
    });

    return environment;
  }

  /**
   * The project's environment, bringing a project from before the
   * one-environment rule to it first. Idempotent, and a no-op beyond one read
   * for a project that already follows it.
   *
   * 1. Its environment is the first linked one (the default, else the first in
   *    order) when no other project links that one too; otherwise a new one is
   *    made from that one's definition, or empty when nothing was linked.
   * 2. The repositories of every other linked environment are merged into it.
   * 3. A device folder of this project's — and of no other project's — that an
   *    other linked environment built is moved to it, so the folder keeps
   *    running. A folder another project also uses stays where it is.
   * 4. The other links are removed — except one whose environment still holds
   *    a folder this project shares, kept as a non-default link so the folder
   *    keeps resolving. The environments themselves stay in「设置 → 环境」.
   * 5. Its name follows the project's.
   */
  static async ensure(
    database: LobeChatDatabase,
    project: ProjectEnvironmentOwner,
  ): Promise<EnvironmentItem> {
    const [settled] = await database
      .select()
      .from(environments)
      .where(eq(environments.projectId, project.id))
      .limit(1);
    if (settled && (await ProjectEnvironmentRepository.isSettled(database, project, settled)))
      return settled;

    return database.transaction(async (tx) => {
      const db = tx as LobeChatDatabase;
      // Two first reads of the same project must not both make one.
      await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, project.id))
        .for('update');

      const linked = await db
        .select({ environment: environments, link: projectEnvironments })
        .from(projectEnvironments)
        .innerJoin(environments, eq(environments.id, projectEnvironments.environmentId))
        .where(eq(projectEnvironments.projectId, project.id))
        .orderBy(
          desc(projectEnvironments.isDefault),
          asc(projectEnvironments.sortOrder),
          asc(projectEnvironments.createdAt),
        );

      let [own] = await db
        .select()
        .from(environments)
        .where(eq(environments.projectId, project.id))
        .limit(1);

      if (!own) {
        const primary = linked.find(({ environment }) => !environment.projectId)?.environment;
        const claimable =
          primary &&
          !(await ProjectEnvironmentRepository.linkedElsewhere(db, primary.id, project.id));
        if (claimable) {
          [own] = await db
            .update(environments)
            .set({ projectId: project.id, updatedAt: new Date() })
            .where(eq(environments.id, primary.id))
            .returning();
        } else {
          [own] = await db
            .insert(environments)
            .values({
              configuration: primary?.configuration ?? {
                excludePaths: [...DEFAULT_REGENERABLE_PATHS],
                kind: 'code',
              },
              description: primary?.description ?? null,
              name: project.name,
              projectId: project.id,
              userId: project.userId,
              visibility: projectEnvironmentVisibility(project),
              workspaceId: project.workspaceId,
            })
            .returning();
        }
      }

      const others = linked
        .map(({ environment }) => environment)
        .filter((environment) => environment.id !== own.id);

      const configuration = mergeRepositories(
        own.configuration,
        others.map((environment) => environment.configuration),
      );
      const visibility = projectEnvironmentVisibility(project);
      // The name follows the project: it is not editable on its own, so a
      // renamed project brings its environment's name along.
      if (
        configuration !== own.configuration ||
        own.visibility !== visibility ||
        own.name !== project.name
      ) {
        [own] = await db
          .update(environments)
          .set({ configuration, name: project.name, updatedAt: new Date(), visibility })
          .where(eq(environments.id, own.id))
          .returning();
      }

      if (others.length > 0) {
        const otherIds = others.map((environment) => environment.id);
        await ProjectEnvironmentRepository.moveFolders(db, project.id, own.id, otherIds);
        // A folder this project shares with another one stays in the
        // environment that built it (moving it would take it from the other
        // project), and a folder resolves only through an environment its
        // project links — so that link stays, as a non-default one. Every
        // other link goes.
        const kept = await ProjectEnvironmentRepository.foldersHeldBy(db, project.id, otherIds);
        const dropped = otherIds.filter((id) => !kept.has(id));
        if (kept.size > 0)
          await db
            .update(projectEnvironments)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(
              and(
                eq(projectEnvironments.projectId, project.id),
                inArray(projectEnvironments.environmentId, [...kept]),
              ),
            );
        if (dropped.length > 0)
          await db
            .delete(projectEnvironments)
            .where(
              and(
                eq(projectEnvironments.projectId, project.id),
                inArray(projectEnvironments.environmentId, dropped),
              ),
            );
      }

      await db
        .insert(projectEnvironments)
        .values({
          addedByUserId: project.userId,
          environmentId: own.id,
          isDefault: true,
          projectId: project.id,
          workspaceId: project.workspaceId,
        })
        .onConflictDoUpdate({
          set: { enabled: true, isDefault: true, updatedAt: new Date() },
          target: [projectEnvironments.projectId, projectEnvironments.environmentId],
        });

      return own;
    });
  }

  /**
   * Removes a deleted project's environment when nothing was built from it.
   * One that has instances stays, standalone, for its creator to clean up from
   * 「设置 → 环境」: its builds live on the execution plane, and dropping the row
   * first would leave storage nobody can name.
   */
  /**
   * Whether a project already follows the rule: its own environment, named and
   * published as the project is, is its enabled default link, and any other
   * link is a non-default one kept for a folder it shares with another project.
   */
  private static async isSettled(
    db: LobeChatDatabase,
    project: ProjectEnvironmentOwner,
    own: EnvironmentItem,
  ) {
    if (own.visibility !== projectEnvironmentVisibility(project) || own.name !== project.name)
      return false;

    const links = await db
      .select({
        environmentId: projectEnvironments.environmentId,
        isDefault: projectEnvironments.isDefault,
        enabled: projectEnvironments.enabled,
      })
      .from(projectEnvironments)
      .where(eq(projectEnvironments.projectId, project.id));

    const ownLink = links.find((link) => link.environmentId === own.id);
    if (!ownLink?.isDefault || !ownLink.enabled) return false;

    const others = links.filter((link) => link.environmentId !== own.id);
    if (others.length === 0) return true;
    if (others.some((link) => link.isDefault)) return false;

    const kept = await ProjectEnvironmentRepository.foldersHeldBy(
      db,
      project.id,
      others.map((link) => link.environmentId),
    );
    return others.every((link) => kept.has(link.environmentId));
  }

  /**
   * Which of these environments still hold the instance behind one of this
   * project's device folders — the ones {@link moveFolders} left in place
   * because another project uses the same folder.
   */
  private static async foldersHeldBy(
    db: LobeChatDatabase,
    projectId: string,
    environmentIds: string[],
  ): Promise<Set<string>> {
    if (environmentIds.length === 0) return new Set();
    const rows = await db
      .selectDistinct({ environmentId: environmentInstances.environmentId })
      .from(environmentInstances)
      .innerJoin(
        projectWorkingDirectories,
        and(
          eq(projectWorkingDirectories.deviceId, environmentInstances.deviceId),
          eq(projectWorkingDirectories.path, environmentInstances.workingDirectory),
          eq(projectWorkingDirectories.projectId, projectId),
        ),
      )
      .where(
        and(
          inArray(environmentInstances.environmentId, environmentIds),
          eq(environmentInstances.kind, 'device'),
        ),
      );
    return new Set(rows.map((row) => row.environmentId));
  }

  private static async linkedElsewhere(
    db: LobeChatDatabase,
    environmentId: string,
    projectId: string,
  ) {
    const [row] = await db
      .select({ id: projectEnvironments.id })
      .from(projectEnvironments)
      .where(
        and(
          eq(projectEnvironments.environmentId, environmentId),
          ne(projectEnvironments.projectId, projectId),
        ),
      )
      .limit(1);

    return !!row;
  }

  /**
   * Re-homes the device instances behind this project's folders from the
   * environments it stops linking to its own, so each folder keeps resolving
   * through the project's link. An instance behind a folder of another project
   * too stays: moving it would take the folder away from that project.
   */
  private static async moveFolders(
    db: LobeChatDatabase,
    projectId: string,
    environmentId: string,
    fromEnvironmentIds: string[],
  ) {
    const folders = await db
      .select({ id: environmentInstances.id })
      .from(environmentInstances)
      .innerJoin(
        projectWorkingDirectories,
        and(
          eq(projectWorkingDirectories.deviceId, environmentInstances.deviceId),
          eq(projectWorkingDirectories.path, environmentInstances.workingDirectory),
          eq(projectWorkingDirectories.projectId, projectId),
        ),
      )
      .where(
        and(
          inArray(environmentInstances.environmentId, fromEnvironmentIds),
          eq(environmentInstances.kind, 'device'),
          notExists(
            db
              .select({ id: projectWorkingDirectories.id })
              .from(projectWorkingDirectories)
              .where(
                and(
                  eq(projectWorkingDirectories.deviceId, environmentInstances.deviceId),
                  eq(projectWorkingDirectories.path, environmentInstances.workingDirectory),
                  ne(projectWorkingDirectories.projectId, projectId),
                ),
              ),
          ),
        ),
      );
    if (folders.length === 0) return;
    const moved = folders.map((folder) => folder.id);

    // A link may name a moved instance as its default, through a foreign key
    // on (environment, instance): left as it is, the move would break it.
    await db
      .update(projectEnvironments)
      .set({ defaultInstanceId: null, updatedAt: new Date() })
      .where(inArray(projectEnvironments.defaultInstanceId, moved));

    await db
      .update(environmentInstances)
      .set({ environmentId, updatedAt: new Date() })
      .where(
        inArray(
          environmentInstances.id,
          folders.map((folder) => folder.id),
        ),
      );
  }
}
