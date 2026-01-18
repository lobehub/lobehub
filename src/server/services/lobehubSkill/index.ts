import { type LobeChatDatabase } from '@lobechat/database';
import { MarketSDK } from '@lobehub/market-sdk';
import debug from 'debug';

import { UserModel } from '@/database/models/user';
import { generateTrustedClientToken } from '@/libs/trusted-client';

const log = debug('lobe-server:lobehub-skill-service');

export interface LobehubSkillExecuteParams {
  args: Record<string, any>;
  provider: string;
  toolName: string;
}

export interface LobehubSkillExecuteResult {
  content: string;
  error?: { code: string; message?: string };
  success: boolean;
}

export class LobehubSkillService {
  private db: LobeChatDatabase;
  private userId: string;
  private marketSDK?: MarketSDK;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  /**
   * Initialize MarketSDK with trusted client token
   */
  private async getMarketSDK(): Promise<MarketSDK | null> {
    if (this.marketSDK) return this.marketSDK;

    try {
      const user = await UserModel.findById(this.db, this.userId);
      if (!user?.email) {
        log('getMarketSDK: user email not found');
        return null;
      }

      const trustedClientToken = generateTrustedClientToken({
        email: user.email,
        name: user.fullName || user.firstName || undefined,
        userId: this.userId,
      });

      if (!trustedClientToken) {
        log('getMarketSDK: trusted client not configured');
        return null;
      }

      this.marketSDK = new MarketSDK({
        baseURL: process.env.NEXT_PUBLIC_MARKET_BASE_URL,
        trustedClientToken,
      });

      return this.marketSDK;
    } catch (error) {
      log('getMarketSDK: error creating SDK: %O', error);
      return null;
    }
  }

  /**
   * Execute a LobeHub Skill tool
   */
  async execute(params: LobehubSkillExecuteParams): Promise<LobehubSkillExecuteResult> {
    const { provider, toolName, args } = params;

    log('execute: %s/%s with args: %O', provider, toolName, args);

    const sdk = await this.getMarketSDK();
    if (!sdk) {
      return {
        content:
          'MarketSDK not available. Please ensure you are authenticated with LobeHub Market.',
        error: { code: 'MARKET_SDK_NOT_AVAILABLE' },
        success: false,
      };
    }

    try {
      const response = await sdk.skills.callTool(provider, {
        args,
        tool: toolName,
      });

      log('execute: response: %O', response);

      return {
        content: typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
        success: response.success,
      };
    } catch (error) {
      const err = error as Error;
      console.error('LobehubSkillService.execute error %s/%s: %O', provider, toolName, err);

      return {
        content: err.message,
        error: { code: 'LOBEHUB_SKILL_ERROR', message: err.message },
        success: false,
      };
    }
  }
}
