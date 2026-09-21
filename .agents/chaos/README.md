# Agent Chaos experiments

Application-specific experiment fixtures live here. Every fixture must declare an environment
allowlist, deterministic seed, bounded timeout, target adapter, effect and at least one independent
oracle. Production environments require an external approval policy and are not enabled by the
portable runner.

Fixture provenance may be an incident (`discoveredFrom`), an evaluation finding, or an explicit
hypothesis. Once a probabilistic run finds a failure, preserve its seed and reduce it to a stable
fixture.
