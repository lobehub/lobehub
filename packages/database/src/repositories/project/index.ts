import type { CreateProjectInput } from '../../models/project';
import {
  normalizeProjectIdentifier,
  ProjectIdentifierTakenError,
  ProjectModel,
} from '../../models/project';
import { createProjectMainAgent } from '../../models/projectMainAgent';
import type { LobeChatDatabase } from '../../type';

/**
 * Cross-aggregate write flow for projects. Creating a project also creates (or
 * binds) its main agent — an `agents` row that AgentModel owns and that outlives
 * the project — so the transaction spanning both aggregates lives here, while
 * {@link ProjectModel.create} owns only the project row and its coordinator link
 * row.
 */
export class ProjectRepository {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  async create(input: CreateProjectInput) {
    const identifier = normalizeProjectIdentifier(input.identifier);

    return this.db.transaction(async (tx) => {
      const db = tx as LobeChatDatabase;
      const projectModel = new ProjectModel(db, this.userId, this.workspaceId);

      // Fail before the main agent is written when the identifier is taken. The
      // model re-checks inside its own transaction and translates the unique
      // violation, which covers the concurrent-create race.
      if (identifier && (await projectModel.isIdentifierTaken(identifier))) {
        throw new ProjectIdentifierTakenError(identifier);
      }

      const mainAgent = input.coordinatorAgentId
        ? await projectModel.findAccessibleAgent(db, input.coordinatorAgentId)
        : await createProjectMainAgent(
            db,
            { userId: this.userId, workspaceId: this.workspaceId },
            { avatar: input.avatar, name: input.name, visibility: input.visibility },
          );
      if (!mainAgent) throw new Error('Agent not found');

      if (input.coordinatorAgentId) {
        projectModel.assertSharedResource(
          { visibility: input.visibility ?? 'private', workspaceId: this.workspaceId ?? null },
          (mainAgent as { visibility: string }).visibility,
          'A shared project only takes shared agents',
        );
      }

      return projectModel.create({
        ...input,
        coordinatorAgentId: mainAgent.id,
        identifier,
      });
    });
  }
}
