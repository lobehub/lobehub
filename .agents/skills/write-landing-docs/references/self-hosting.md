# Self-Hosting Documentation Reference

Read this reference for pages under `docs/self-hosting/**`.

## Default Audience

Public self-hosting documentation primarily serves individuals and small teams. Assume:

- a small dataset compared with LobeHub Cloud;
- limited operational time and infrastructure;
- a preference for the fewest required services and background processes;
- a need for copyable steps and an obvious way to verify the result;
- either a person or an automation agent may execute the guide literally.

LobeHub Cloud is the largest deployment and an important correctness boundary, but it is not the
default sizing model for public self-hosting instructions. Keep Cloud-scale backfills, rollout
coordination, and private operational procedures in their owning runbooks unless a self-hosted user
must perform the same work.

## Separate the Deployment Axes

Do not infer the database or available capabilities from the application deployment method. Treat
these as separate axes:

1. **Application runtime:** Docker Compose, Vercel, a standalone Node process, or another custom
   deployment.
2. **Database:** bundled or self-managed PostgreSQL, Neon, or another managed PostgreSQL provider.
3. **Auxiliary runtime:** persistent workers, queues, object storage, search services, and other
   processes that may not fit every application runtime.

For example, a Docker deployment can connect to Neon. Some users build in GitHub Actions or another
environment and deploy the resulting artifacts to Vercel when the free Vercel builder lacks enough
memory for the repository. Do not remove or ignore non-Docker instructions solely because one
hosted build path is constrained; verify the current build limit before stating it publicly.

Avoid documenting every Cartesian combination as a separate guide. Use one canonical task page and
branch only at the step where commands or prerequisites differ. Split a deployment-specific page
only when its setup, lifecycle, or recovery procedure is substantially different.

## Information Order

A self-hosting guide should answer these questions in order:

1. **Does this apply to me?** Name the affected service, configuration, version, or provider signal.
2. **What should I choose?** Recommend the simplest supported path for the default audience.
3. **What do I do?** Give a short numbered procedure with exact configuration and commands.
4. **How do I know it worked?** Verify both existing data and newly created data when migration or
   synchronization is involved.
5. **How do I recover?** State rollback, retry, backup, and destructive-operation boundaries where
   relevant.
6. **What are the advanced alternatives?** Describe them after the normal path, with the additional
   services and ongoing maintenance made explicit.

A compact decision table is useful when a reader must identify whether they are affected or choose
between a small number of options. Do not add a matrix when one recommendation and one exception are
clearer as prose.

## Detail Level

Optimize for successful execution, not for documenting the implementation exhaustively.

Include details that change what the reader must decide or do:

- prerequisites and compatibility boundaries;
- exact environment variables, configuration values, commands, and deployment actions;
- data ownership, backup expectations, and destructive-operation warnings;
- required persistent processes and third-party services;
- verification, rollback, and common failure signals.

Omit internal class names, repository layering, algorithm walkthroughs, and historical design
discussion unless they are necessary to operate the deployment safely. Point advanced readers to a
focused technical reference or the relevant source instead of interrupting the main procedure.

## Migration Guidance

- Identify the affected users before describing migration steps. A provider announcement or
  project-specific notice is stronger evidence than a deployment label.
- Preserve the existing source of truth unless the migration explicitly moves it. Say what data is
  copied, indexed, or left in place.
- Prefer the lowest-operational-cost supported option for personal deployments. Present services
  that require persistent workers, backfills, or continuous synchronization as advanced choices.
- Distinguish application cutover from historical backfill and ongoing synchronization. A one-time
  import is not a substitute for a persistent worker.
- Use provider-specific deadlines only when they are authoritative for the affected project. Do not
  turn one user's notice into a universal deadline.
- Never instruct users to delete extensions, indexes, volumes, or source data as part of the happy
  path unless the product owns a verified cleanup procedure and the deletion is genuinely required.

## Agent-Executable Writing

Write so an agent can follow the page without inventing missing decisions:

- use numbered steps for the primary path;
- keep one action per step when practical;
- name the file, setting surface, or deployment environment being changed;
- show complete commands with their working-directory assumptions;
- state expected output or observable behavior;
- label optional and advanced steps explicitly;
- avoid instructions such as "configure as needed" when the valid values and decision rule can be
  stated directly.
