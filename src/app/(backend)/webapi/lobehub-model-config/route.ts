import {
  isLobeHubModelAvailable,
  loadLobeHubPlanCardModels,
  loadModels,
} from '@lobechat/business-model-bank/model-config';
import { ModelProvider } from 'model-bank';
import { NextResponse } from 'next/server';

import { auth } from '@/auth';

/**
 * Public model config for the LobeHub (branded) provider, consumed by the
 * business-model-bank browser loader (`LobeHubPath.webapi.modelConfig`).
 *
 * The payload comes entirely from the `@lobechat/business-model-bank` slot:
 * with the OSS default implementation the LobeHub provider list is empty and
 * this returns an empty config; business overrides that serve a real model
 * directory light it up without any route changes.
 *
 * This is the actual source the model picker's LobeHub group renders from —
 * NOT the aiModel.getAiProviderModelList tRPC procedure, which also gates beta
 * models but is a different call path entirely. Skipping the check here means
 * a beta-gated model still shows (and is selectable) for every ungranted user
 * regardless of that gate. Stays a public route on purpose (no auth required
 * to load it) — an anonymous caller simply gets no session, so every beta
 * model is filtered out for them, same as a logged-in but ungranted user.
 */
export const GET = async (request: Request) => {
  try {
    const [models, planCardModels] = await Promise.all([
      loadModels(),
      loadLobeHubPlanCardModels().catch(() => [] as string[]),
    ]);

    const clientModels = models.filter(
      (model) =>
        model.providerId === ModelProvider.LobeHub &&
        model.enabled !== false &&
        (model as { visible?: boolean }).visible !== false,
    );

    const session = await auth.api.getSession({ headers: request.headers });
    const userEmail = session?.user?.email;
    const availability = await Promise.all(
      clientModels.map((model) => isLobeHubModelAvailable(model.id, model.type, { userEmail })),
    );
    const availableModels = clientModels.filter((_, index) => availability[index]);

    return NextResponse.json({
      models: availableModels,
      planCardModels,
      version: 1,
    });
  } catch (error) {
    console.error('[lobehub-model-config] failed to load model config:', error);
    return NextResponse.json({ models: [], planCardModels: [], version: 1 });
  }
};
