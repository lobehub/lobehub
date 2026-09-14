# Search mapping history

Each numbered directory is a source-history batch, not an executable SQL migration or an entity
schema version. `0000-initial-search-indexes` contains all initial v1 indexes. Later batches contain
complete physical definitions only for entities that change.

- `mapping.ts` binds the batch ID, entity definitions and analysis settings.
- `fields.ts` owns fixed field presets and shared property fragments for that batch.
- `analysis.ts` owns fixed analysis settings. A later batch can import an unchanged earlier analysis.
- `index.ts` registers all batches and explicitly selects the current batch for each entity.
- `../policy.ts` owns current query and document metadata; `../zodSchema.ts` owns current validation.
- `../mappings.ts` combines current physical definitions and policy for existing consumers.

For a new mapping, add the next numbered directory with a meaningful name, increment each affected
entity's `schemaVersion`, register the batch and update its current pointers. Retain historical fields
even when the current Zod schema removes them. Analysis is still global: changing it requires a new
version for every current entity. Current mapping fields plus explicitly retained source properties
in `../policy.ts` must match the current Zod schema exactly, without overlap. Retain source fields
and builder output while any old open index needs them; reindex omits source-only fields from the
current strict mapping, while sync continues filling older mappings. Only remove the retained
properties after the old indexes are closed and rollback to their code is no longer needed.

Append approved fingerprints to `../__tests__/schemaSnapshots.json`. The PR history check compares
the merge result with the target commit: existing batch directories and JSON baseline entries cannot
change, including when both mapping and fingerprint are edited together. New batches must have
higher, unique ordinals. Keep this CI job required in repository rules to enforce the guard; tests
still verify registration, current pointers, field coverage and version/fingerprint consistency.

This catalog does not execute migrations or reconstruct old documents with the current builder.
Build, promote, rollback, retire and purge continue through the Elasticsearch reindex commands.
