/**
 * Lobe Mini Game Executor
 *
 * Drives the character of the mini game panel. Runs in the browser tab that
 * hosts the game: in gateway mode the server dispatches each call here as a
 * client `tool_execute` (see `browserExecutedToolIds`), in client mode the
 * local agent loop invokes it directly.
 */
import {
  type MiniGameActionState,
  MiniGameApiName,
  type MiniGameApiNameType,
  MiniGameIdentifier,
} from '@lobechat/builtin-tool-mini-game';
import {
  buildGameStateXml,
  describeCharacter,
  describeSurroundings,
  parseActionParams,
} from '@lobechat/builtin-tool-mini-game/engine';
import { BaseExecutor, type BuiltinToolResult } from '@lobechat/types';

import { miniGameActions, useMiniGameStore } from '@/store/miniGame';

type ActionApiName = Exclude<MiniGameApiNameType, 'getGameState'>;

const describeOutcome = (apiName: ActionApiName, steps: number, targetId?: string): string => {
  const target = targetId ?? 'the target cell';
  switch (apiName) {
    case MiniGameApiName.sitOn: {
      return `Walked ${steps} step(s) and sat down on ${target}.`;
    }
    case MiniGameApiName.watch: {
      return `Walked ${steps} step(s) and started watching ${target}.`;
    }
    default: {
      return `Walked ${steps} step(s) and arrived at ${target}.`;
    }
  }
};

class MiniGameExecutor extends BaseExecutor<typeof MiniGameApiName> {
  readonly identifier = MiniGameIdentifier;
  protected readonly apiEnum = MiniGameApiName;

  getGameState = async (): Promise<BuiltinToolResult> => {
    const { character, isOpen, scene } = useMiniGameStore.getState();
    if (!isOpen) return this.#gameNotOpen();
    return { content: buildGameStateXml(scene, character), success: true };
  };

  moveTo = (params: unknown) => this.#act(MiniGameApiName.moveTo, params);

  sitOn = (params: unknown) => this.#act(MiniGameApiName.sitOn, params);

  watch = (params: unknown) => this.#act(MiniGameApiName.watch, params);

  #act = async (apiName: ActionApiName, params: unknown): Promise<BuiltinToolResult> => {
    const parsed = parseActionParams(apiName, params);
    if (!parsed.ok) return this.#failure(parsed.error.type, parsed.error.message);

    const result = await miniGameActions.perform(parsed.request);
    const { character, scene } = useMiniGameStore.getState();
    const status = `${describeCharacter(scene, character)}. ${describeSurroundings(scene, character)}`;
    if (!result.ok)
      return this.#failure(result.error.type, `${result.error.message} Now: ${status}`);

    const { plan, steps } = result;
    const headline = plan.alreadyDone
      ? 'Already doing that; nothing changed.'
      : describeOutcome(apiName, steps, plan.targetId);

    const state: MiniGameActionState = {
      arrived: true,
      pose: character.pose,
      position: character.position,
      steps,
      targetId: plan.targetId,
    };
    return { content: `${headline} Now: ${status}`, state, success: true };
  };

  #gameNotOpen = () =>
    this.#failure(
      'game_not_open',
      'The mini game panel is closed, so the character cannot move. Ask the user to open it.',
    );

  #failure = (type: string, message: string): BuiltinToolResult => ({
    content: message,
    error: { message, type },
    success: false,
  });
}

export const miniGameExecutor = new MiniGameExecutor();
