import type {
  UserAgentOnboarding,
  UserAgentOnboardingDraft,
  UserAgentOnboardingNode,
} from '@lobechat/types';

import { getScopedPatch, isRecord, normalizeFromSchema, sanitizeText } from './nodeSchema';

type OnboardingPatchInput = Record<string, unknown>;
type DraftKey = keyof Omit<UserAgentOnboardingDraft, 'responseLanguage'>;

interface CommitSideEffects {
  updateInterests?: string[];
  updateResponseLanguage?: string;
  updateUserName?: string;
}

export interface NodeHandler {
  commitToState: (
    state: UserAgentOnboarding,
    draft: UserAgentOnboardingDraft,
  ) => { errorMessage?: string; sideEffects?: CommitSideEffects; success: boolean };
  readonly draftKey: DraftKey | 'responseLanguage';
  extractDraft: (patch: OnboardingPatchInput) => Partial<UserAgentOnboardingDraft> | undefined;
  getDraftValue: (draft: UserAgentOnboardingDraft) => unknown;
  mergeDraft: (draft: UserAgentOnboardingDraft, patch: unknown) => UserAgentOnboardingDraft;
}

const makeProfileNodeHandler = (
  node: UserAgentOnboardingNode,
  draftKey: DraftKey,
  commitTarget:
    | { key: 'agentIdentity' }
    | {
        extraProfile?: (committed: Record<string, unknown>) => Record<string, unknown>;
        key: 'profile';
        profileKey: string;
      },
  sideEffectsFn?: (committed: Record<string, unknown>) => CommitSideEffects | undefined,
): NodeHandler => ({
  draftKey,
  commitToState: (state, draft) => {
    const committed = normalizeFromSchema(node, draft[draftKey], 'committed') as
      | Record<string, unknown>
      | undefined;
    if (!committed) {
      return { errorMessage: `${node} has not been captured yet.`, success: false };
    }

    if (commitTarget.key === 'agentIdentity') {
      state.agentIdentity = committed as unknown as UserAgentOnboarding['agentIdentity'];
    } else {
      state.profile = {
        ...state.profile,
        [commitTarget.profileKey]: committed,
        ...commitTarget.extraProfile?.(committed),
      };
    }

    return {
      sideEffects: sideEffectsFn?.(committed),
      success: true,
    };
  },
  extractDraft: (patch) => {
    const scopedPatch = getScopedPatch(node, patch);
    const normalized = normalizeFromSchema(node, scopedPatch, 'draft');
    return normalized
      ? ({ [draftKey]: normalized } as Partial<UserAgentOnboardingDraft>)
      : undefined;
  },
  getDraftValue: (draft) => draft[draftKey],
  mergeDraft: (draft, patch) => {
    const patchRecord = isRecord(patch) ? patch : {};
    return { ...draft, [draftKey]: { ...draft[draftKey], ...patchRecord } };
  },
});

const responseLanguageHandler: NodeHandler = {
  draftKey: 'responseLanguage',
  commitToState: (_state, draft) => {
    if (draft.responseLanguage === undefined) {
      return { errorMessage: 'Response language has not been captured yet.', success: false };
    }
    return {
      sideEffects: { updateResponseLanguage: draft.responseLanguage },
      success: true,
    };
  },
  extractDraft: (patch) => {
    const responseLanguage = sanitizeText(
      typeof patch.responseLanguage === 'string' ? patch.responseLanguage : undefined,
    );
    return responseLanguage ? { responseLanguage } : undefined;
  },
  getDraftValue: (draft) => draft.responseLanguage,
  mergeDraft: (draft, patch) => ({ ...draft, responseLanguage: patch as string }),
};

export const NODE_HANDLERS: Partial<Record<UserAgentOnboardingNode, NodeHandler>> = {
  agentIdentity: makeProfileNodeHandler('agentIdentity', 'agentIdentity', {
    key: 'agentIdentity',
  }),
  painPoints: makeProfileNodeHandler('painPoints', 'painPoints', {
    key: 'profile',
    profileKey: 'painPoints',
  }),
  responseLanguage: responseLanguageHandler,
  userIdentity: makeProfileNodeHandler(
    'userIdentity',
    'userIdentity',
    {
      key: 'profile',
      profileKey: 'identity',
    },
    (committed) => (committed.name ? { updateUserName: committed.name as string } : undefined),
  ),
  workContext: makeProfileNodeHandler(
    'workContext',
    'workContext',
    {
      extraProfile: (committed) => ({
        ...(committed.currentFocus ||
        committed.thisWeek ||
        committed.thisQuarter ||
        committed.summary
          ? {
              currentFocus:
                (committed.currentFocus as string) ||
                (committed.thisWeek as string) ||
                (committed.thisQuarter as string) ||
                (committed.summary as string),
            }
          : {}),
        interests: Array.isArray(committed.interests)
          ? (committed.interests as string[])
          : undefined,
      }),
      key: 'profile',
      profileKey: 'workContext',
    },
    (committed) =>
      Array.isArray(committed.interests) && committed.interests.length > 0
        ? { updateInterests: committed.interests as string[] }
        : undefined,
  ),
  workStyle: makeProfileNodeHandler('workStyle', 'workStyle', {
    key: 'profile',
    profileKey: 'workStyle',
  }),
};

export const PROFILE_DOCUMENT_NODES = new Set<UserAgentOnboardingNode>([
  'agentIdentity',
  'userIdentity',
  'workStyle',
  'workContext',
  'painPoints',
]);
