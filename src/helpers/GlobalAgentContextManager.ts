export interface LobeGlobalAgentContext {
  // Other potential context
  currentTime?: string;

  // App's data directory
  // Paths commonly used by agents
  desktopPath?: string;
  documentsPath?: string;
  downloadsPath?: string;
  homePath?: string;
  musicPath?: string;
  picturesPath?: string; // User's home directory
  userDataPath?: string;

  videosPath?: string;
  // Add other global context properties needed by agents here
}

// Augment the Window interface to include our global context
declare global {
  interface Window {
    __LOBE_GLOBAL_AGENT_CONTEXT__?: LobeGlobalAgentContext;
  }
}

const CONTEXT_KEY = '__LOBE_GLOBAL_AGENT_CONTEXT__';

class GlobalAgentContextManager {
  private get context(): LobeGlobalAgentContext {
    if (typeof window === 'undefined') return {};
    if (!window[CONTEXT_KEY]) {
      window[CONTEXT_KEY] = {};
    }
    return window[CONTEXT_KEY]!;
  }

  private set context(value: LobeGlobalAgentContext) {
    if (typeof window === 'undefined') return;
    window[CONTEXT_KEY] = value;
  }

  /**
   * Retrieves the current global agent context.
   */
  public getContext(): LobeGlobalAgentContext {
    return this.context;
  }

  /**
   * Updates the global agent context by merging updates.
   * This is typically called by the Electron store initializer.
   * @param updates - Partial context updates to merge.
   */
  public updateContext(updates: Partial<LobeGlobalAgentContext>): void {
    this.context = { ...this.context, ...updates };
  }

  /**
   * Sets the entire global agent context, replacing the existing one.
   * @param context - The new context object.
   */
  public setContext(context: LobeGlobalAgentContext): void {
    this.context = context;
  }

  /**
   * Fills a template string using the current global agent context.
   * Replaces {{key}} placeholders with values from the context.
   * @param template - The template string with placeholders.
   * @returns The filled template string.
   */
  public fillTemplate(template?: string): string {
    const ctx = this.getContext();
    if (!template) return '';

    // Updated to use replaceAll for potentially multiple occurrences
    return template.replaceAll(/{{([^}]+)}}/g, (match, key) => {
      const trimmedKey = key.trim() as keyof LobeGlobalAgentContext;
      return ctx[trimmedKey] !== undefined ? String(ctx[trimmedKey]) : '[N/A]';
    });
  }
}

// Export a singleton instance for global use
export const globalAgentContextManager = new GlobalAgentContextManager();
