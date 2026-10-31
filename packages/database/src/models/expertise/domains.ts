import {
  type ExpertiseAnchorCandidate,
  type ExpertiseCanonEntry,
  type ExpertiseLayerDefinition,
} from '@lobechat/types';
import { and, asc, eq, isNotNull, or, type SQL, sql } from 'drizzle-orm';

import { expertiseBindings, expertiseDomains } from '../../schemas';
import { idGenerator } from '../../utils/idGenerator';
import { domainScopeWhere, type ExpertiseContext } from './context';

/**
 * Where a domain is mounted. Ownership (`expertise_domains.user_id` / `workspace_id`) is a
 * separate axis: a project never owns a domain, it only mounts one, so the same standard can be
 * mounted by several projects at once.
 */
export type ExpertiseCarrier =
  { id: string; type: 'agent' } | { id: string; type: 'project' } | { type: 'user' };

/**
 * The single carrier column a binding sets. `user` resolves to the workspace when one is in
 * scope, so a workspace member's always-on standards reach their teammates rather than only
 * themselves — the same arm `listDomainsBoundTo` reads back.
 */
const carrierColumns = (
  carrier: ExpertiseCarrier,
  owner: { userId: string; workspaceId?: string },
) => {
  if (carrier.type === 'agent') return { agentId: carrier.id };
  if (carrier.type === 'project') return { projectId: carrier.id };
  return owner.workspaceId
    ? { boundWorkspaceId: owner.workspaceId }
    : { boundUserId: owner.userId };
};

export const listDomainsBoundTo = async (ctx: ExpertiseContext, carrierWhere?: SQL) => {
  const ownerWhere = ctx.workspaceId
    ? eq(expertiseBindings.boundWorkspaceId, ctx.workspaceId)
    : eq(expertiseBindings.boundUserId, ctx.userId);

  const rows = await ctx.db
    .select({
      binding: {
        contributionMode: expertiseBindings.contributionMode,
        enabled: expertiseBindings.enabled,
        id: expertiseBindings.id,
        sortOrder: expertiseBindings.sortOrder,
      },
      domain: expertiseDomains,
    })
    .from(expertiseBindings)
    .innerJoin(expertiseDomains, eq(expertiseDomains.id, expertiseBindings.domainId))
    .where(
      and(
        eq(expertiseBindings.enabled, true),
        isNotNull(expertiseDomains.anchorChosenAt),
        domainScopeWhere(ctx),
        carrierWhere ? or(carrierWhere, ownerWhere) : ownerWhere,
      ),
    )
    // Every binding starts at sortOrder 0, so without a tiebreak the order of a reviewer's
    // groups is whatever the planner returns and a newly opened group can jump to the top.
    .orderBy(asc(expertiseBindings.sortOrder), asc(expertiseDomains.createdAt));

  // One domain may be bound at multiple levels; retain the first binding by sort order.
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.domain.id)) return false;
    seen.add(r.domain.id);
    return true;
  });
};

/**
 * Who a domain reaches, as one comparable key — the same rule `listRules` uses for its
 * `owner`: `mine` when any enabled binding is not an agent's (the reviewer, workspace or a
 * project), otherwise the agents it is mounted on. A rule moved or merged across reaches would
 * silently change which runs receive it, so both mutations refuse that.
 */
const reachOf = async (ctx: ExpertiseContext, domainId: string) => {
  const mounts = await ctx.db
    .select({ agentId: expertiseBindings.agentId })
    .from(expertiseBindings)
    .where(and(eq(expertiseBindings.domainId, domainId), eq(expertiseBindings.enabled, true)));
  if (mounts.some((mount) => !mount.agentId)) return 'mine';
  const agentIds = [...new Set(mounts.map((mount) => mount.agentId!))].sort();
  return agentIds.length > 0 ? `agent:${agentIds.join(',')}` : 'unbound';
};

/** Whether two domains reach the same runs; see {@link reachOf}. */
export const sameReach = async (ctx: ExpertiseContext, domainA: string, domainB: string) => {
  if (domainA === domainB) return true;
  const [a, b] = await Promise.all([reachOf(ctx, domainA), reachOf(ctx, domainB)]);
  return a === b;
};

export const findDomain = async (ctx: ExpertiseContext, domainId: string) => {
  const [row] = await ctx.db
    .select()
    .from(expertiseDomains)
    .where(
      and(
        eq(expertiseDomains.id, domainId),
        isNotNull(expertiseDomains.anchorChosenAt),
        domainScopeWhere(ctx),
      ),
    )
    .limit(1);
  return row;
};

/**
 * Persists a reviewed anchor and mounts it on the selected carrier.
 * The chosen candidate is also kept in anchorCandidates so the alternative can be revisited.
 */
export const createDomain = async (
  ctx: ExpertiseContext,
  params: {
    brief: string;
    canonEntries?: ExpertiseCanonEntry[];
    carrier: ExpertiseCarrier;
    domainFilter: string;
    layerCanonRef?: string;
    layerSource?: 'canonical' | 'invented';
    layers?: ExpertiseLayerDefinition[];
    outOfScope?: string;
    rationale?: string;
    title: string;
  },
) => {
  const brief = params.brief.trim();
  const id = idGenerator('expertiseDomains');
  const title = params.title.trim();
  const domainFilter = params.domainFilter.trim();
  const slug = `${title.slice(0, 40).replaceAll(/\s+/g, '-').toLowerCase()}-${id.slice(-6)}`;
  const layers = params.layers ?? [];
  const canonEntries = params.canonEntries ?? [];
  const layerSource = params.layerSource ?? 'invented';
  const candidate: ExpertiseAnchorCandidate = {
    canonEntries,
    domainFilter,
    key: 'chosen',
    layerCanonRef: params.layerCanonRef,
    layers,
    layerSource,
    outOfScope: params.outOfScope?.trim() || undefined,
    rationale: params.rationale?.trim() || undefined,
    title,
  };

  await ctx.db.transaction(async (tx) => {
    await tx.insert(expertiseDomains).values({
      anchorCandidates: [candidate],
      anchorChosenAt: new Date(),
      anchorChosenByUserId: ctx.userId,
      canonEntries,
      description: brief,
      domainFilter,
      id,
      layerSource,
      layers,
      outOfScope: params.outOfScope?.trim() || null,
      seedState: 'seeded',
      slug,
      title,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });
    const carrier = carrierColumns(params.carrier, {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });
    // A new mount goes after the ones already there. Leaving every binding at 0 makes the
    // reviewer's group order depend on the query plan.
    const [carrierColumn, carrierValue] = Object.entries(carrier)[0] as [
      keyof typeof expertiseBindings.$inferInsert,
      string,
    ];
    const [last] = await tx
      .select({ sortOrder: sql<number>`max(${expertiseBindings.sortOrder})` })
      .from(expertiseBindings)
      .where(eq(expertiseBindings[carrierColumn as 'boundUserId'], carrierValue));
    await tx.insert(expertiseBindings).values({
      addedByUserId: ctx.userId,
      domainId: id,
      sortOrder: (last?.sortOrder ?? -1) + 1,
      workspaceId: ctx.workspaceId,
      ...carrier,
    });
  });
  return id;
};

/**
 * Deletes a domain the user owns together with everything learned in it — bindings, lessons,
 * runs, hits, snapshots and insights all cascade from the domain row. Nothing is kept: the
 * user chose to drop the direction, not to pause it.
 */
export const deleteDomain = async (ctx: ExpertiseContext, domainId: string) => {
  const [row] = await ctx.db
    .delete(expertiseDomains)
    .where(and(eq(expertiseDomains.id, domainId), domainScopeWhere(ctx)))
    .returning({ id: expertiseDomains.id });
  return row ?? null;
};

/**
 * A group the reviewer opens by hand. It is a plain always-on domain: the gate question is the
 * domain filter, and it mounts on the reviewer themselves so every acceptance without a project
 * can add to it.
 *
 * A name the reviewer already uses returns that group instead of opening a second one. The
 * drafting model proposes a group name without seeing which ones already exist in every case,
 * and two groups with the same name on one page are indistinguishable to the reader.
 */
export const createRuleGroup = async (
  ctx: ExpertiseContext,
  params: { gate: string; outOfScope?: string; title: string },
) => {
  const title = params.title.trim();
  const existing = await ctx.model.listDomainsForOwner();
  const match = existing.find(
    ({ domain }) => domain.title.trim().toLowerCase() === title.toLowerCase(),
  );
  if (match) return match.domain.id;

  return ctx.model.createDomain({
    brief: title,
    carrier: { type: 'user' },
    domainFilter: params.gate,
    outOfScope: params.outOfScope,
    title,
  });
};

/** Renames a group; the gate question can be changed the same way. */
export const updateRuleGroup = async (
  ctx: ExpertiseContext,
  domainId: string,
  patch: { gate?: string; outOfScope?: string | null; title?: string },
) => {
  const domain = await ctx.model.findDomain(domainId);
  if (!domain) return null;
  const title = patch.title?.trim();
  const gate = patch.gate?.trim();
  await ctx.db
    .update(expertiseDomains)
    .set({
      ...(title && { title }),
      ...(gate && { domainFilter: gate }),
      // Empty clears the exclusion; undefined leaves it alone.
      ...(patch.outOfScope !== undefined && { outOfScope: patch.outOfScope?.trim() || null }),
      updatedAt: new Date(),
    })
    .where(eq(expertiseDomains.id, domainId));
  return { id: domainId };
};
