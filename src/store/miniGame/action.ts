import type {
  GameActionRequest,
  GameObject,
  MiniGameError,
} from '@lobechat/builtin-tool-mini-game';
import {
  type ActionPlan,
  buildGameContextSelection,
  facingTowards,
  planAction,
} from '@lobechat/builtin-tool-mini-game/engine';
import type { GameContextSelection } from '@lobechat/types';
import { t } from 'i18next';

import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { initialState, type MiniGameState } from './initialState';
import { useMiniGameStore } from './store';

const n = setNamespace('miniGame');

/** Time the character takes to cross one cell. */
export const STEP_DURATION_MS = 320;

export type PerformResult =
  { error: MiniGameError; ok: false } | { ok: true; plan: ActionPlan; steps: number };

type Setter = StoreSetter<MiniGameState>;

interface InFlight {
  resolve: (result: PerformResult) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class MiniGameActionImpl {
  readonly #get: () => MiniGameState;
  readonly #set: Setter;
  /** The action being walked; a new action or closing the game interrupts it. */
  #inFlight?: InFlight;

  constructor(set: Setter, get: () => MiniGameState) {
    this.#set = set;
    this.#get = get;
  }

  setOpen = (isOpen: boolean): void => {
    if (!isOpen) this.#interrupt('The mini game was closed before the action finished.');
    this.#set({ isOpen }, false, n('setOpen'));
  };

  /**
   * Plans `request` against the live yard, walks the character there one cell
   * at a time and resolves once the final pose is reached — or with an error
   * when the request is impossible, the game is closed, or another action
   * replaces it.
   */
  perform = (request: GameActionRequest): Promise<PerformResult> => {
    const { character, isOpen, scene } = this.#get();
    if (!isOpen)
      return Promise.resolve({
        error: { message: 'The mini game is not open.', type: 'game_not_open' },
        ok: false,
      });

    const planned = planAction(scene, character, request);
    if (!planned.ok) return Promise.resolve(planned);

    this.#interrupt('A newer action replaced this one.');

    const { plan } = planned;
    if (plan.path.length === 0) {
      this.#set(
        { character: plan.final, path: [], pendingTargetId: undefined },
        false,
        n('arrive'),
      );
      return Promise.resolve({ ok: true, plan, steps: 0 });
    }

    return new Promise<PerformResult>((resolve) => {
      const inFlight: InFlight = { resolve };
      this.#inFlight = inFlight;
      this.#set(
        {
          // Standing up ends whatever the character was doing.
          character: { ...character, activity: undefined, pose: 'walking' },
          path: plan.path,
          pendingTargetId: plan.targetId,
        },
        false,
        n('startWalking'),
      );

      const step = () => {
        if (this.#inFlight !== inFlight) return;
        const { character: current, path } = this.#get();
        const [next, ...rest] = path;

        if (!next) {
          this.#inFlight = undefined;
          this.#set(
            { character: plan.final, path: [], pendingTargetId: undefined },
            false,
            n('arrive'),
          );
          resolve({ ok: true, plan, steps: plan.path.length });
          return;
        }

        this.#set(
          {
            character: {
              ...current,
              facing: facingTowards(current.position, next, current.facing),
              position: next,
            },
            path: rest,
          },
          false,
          n('step'),
        );
        inFlight.timer = setTimeout(step, STEP_DURATION_MS);
      };

      inFlight.timer = setTimeout(step, STEP_DURATION_MS);
    });
  };

  /** The yard as a context selection for the next user message; none while closed. */
  getContextSelection = (): GameContextSelection | undefined => {
    const { character, isOpen, scene } = this.#get();
    if (!isOpen) return;

    const objectName = (object: GameObject) => t(`miniGame.objects.${object.kind}`, { ns: 'chat' });
    const sceneName = t('miniGame.sceneName', { ns: 'chat' });
    return buildGameContextSelection(scene, character, {
      objectName,
      preview: sceneName,
      sceneName,
    });
  };

  reset = (): void => {
    this.#interrupt('The mini game was reset.');
    this.#set(initialState, false, n('reset'));
  };

  #interrupt = (message: string) => {
    const inFlight = this.#inFlight;
    if (!inFlight) return;

    this.#inFlight = undefined;
    clearTimeout(inFlight.timer);
    const { character } = this.#get();
    this.#set(
      { character: { ...character, pose: 'idle' }, path: [], pendingTargetId: undefined },
      false,
      n('interrupt'),
    );
    inFlight.resolve({ error: { message, type: 'interrupted' }, ok: false });
  };
}

const { getState, setState } = useMiniGameStore;

export const miniGameActions = new MiniGameActionImpl(setState, getState);
