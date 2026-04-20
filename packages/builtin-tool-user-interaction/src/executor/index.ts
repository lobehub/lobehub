import { BaseExecutor, type BuiltinToolContext, type BuiltinToolResult } from '@lobechat/types';

import { UserInteractionExecutionRuntime } from '../ExecutionRuntime';
import {
  type AskUserQuestionArgs,
  type CancelUserResponseArgs,
  type GetInteractionStateArgs,
  type SkipUserResponseArgs,
  type SubmitUserResponseArgs,
  UserInteractionApiName,
  UserInteractionIdentifier,
} from '../types';

export class UserInteractionExecutor extends BaseExecutor<typeof UserInteractionApiName> {
  readonly identifier = UserInteractionIdentifier;
  protected readonly apiEnum = UserInteractionApiName;

  private runtime: UserInteractionExecutionRuntime;

  constructor(runtime: UserInteractionExecutionRuntime) {
    super();
    this.runtime = runtime;
  }

  askUserQuestion = async (
    params: AskUserQuestionArgs,
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.askUserQuestion(params);
  };

  submitUserResponse = async (
    params: SubmitUserResponseArgs,
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.submitUserResponse(params);
  };

  skipUserResponse = async (
    params: SkipUserResponseArgs,
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.skipUserResponse(params);
  };

  cancelUserResponse = async (
    params: CancelUserResponseArgs,
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.cancelUserResponse(params);
  };

  getInteractionState = async (
    params: GetInteractionStateArgs,
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.getInteractionState(params);
  };
}

const fallbackRuntime = new UserInteractionExecutionRuntime();

export const userInteractionExecutor = new UserInteractionExecutor(fallbackRuntime);
