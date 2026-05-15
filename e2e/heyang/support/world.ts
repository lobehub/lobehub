import { type IWorldOptions, setWorldConstructor, World } from '@cucumber/cucumber';
import {
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

export class HeyangWorld extends World {
  api?: APIRequestContext;
  baseURL: string;
  browser?: Browser;
  context?: BrowserContext;
  healthFallbackUsed = false;
  lastEndpoint?: string;
  lastResponse?: APIResponse;
  lastText = '';
  page?: Page;

  constructor(options: IWorldOptions) {
    super(options);
    this.baseURL = process.env.BASE_URL || 'http://localhost:3010';
  }
}

setWorldConstructor(HeyangWorld);
