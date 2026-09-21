# Default Audience

Self-hosting documentation primarily serves individuals and small teams:

- Their datasets are usually small. LobeHub Cloud is the largest deployment and a correctness
  boundary, not the default sizing model for public migration instructions.
- Prefer the supported option with the fewest extra services, persistent workers, and operational
  steps. Put Cloud-scale or high-volume procedures in advanced guidance.
- Application deployment and database capability are separate: Docker can connect to Neon, while
  non-Docker users may build in GitHub Actions or elsewhere and deploy the artifact to Vercel.
- Write for a person or agent that wants a short numbered procedure with exact settings, commands,
  and verification. Omit implementation detail that does not change a decision or action; link to
  focused technical documentation or source code instead.
