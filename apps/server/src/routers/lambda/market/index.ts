import { marketDeploymentsRouter } from '@/business/server/lambda-routers/marketDeployments';
import { router } from '@/libs/trpc/lambda';

import { agentRouter } from './agent';
import { agentGroupRouter } from './agentGroup';
import { clientProcedures } from './client';
import { credsRouter } from './creds';
import { discoveryProcedures } from './discovery';
import { oidcRouter } from './oidc';
import { skillRouter } from './skill';
import { socialRouter } from './social';
import { socialProfileRouter } from './socialProfile';
import { userRouter } from './user';

export const marketRouter = router({
  // ============================== Agent Management (authenticated) ==============================
  agent: agentRouter,

  // ============================== Agent Group Management (authenticated) ==============================
  agentGroup: agentGroupRouter,

  // ============================== Credential Management ==============================
  creds: credsRouter,

  // ============================== Artifact Deployments (business) ==============================
  deployments: marketDeploymentsRouter,

  // ============================== Skill Management ==============================
  skill: skillRouter,

  ...discoveryProcedures,

  // ============================== OIDC Authentication ==============================
  oidc: oidcRouter,

  ...clientProcedures,

  // ============================== Social Features ==============================
  social: socialRouter,

  // ============================== Social Profile OAuth ==============================
  socialProfile: socialProfileRouter,

  // ============================== User Profile ==============================
  user: userRouter,
});
