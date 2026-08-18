import { escapeXmlAttr, escapeXmlContent } from '@lobechat/prompts';
import type { RuntimeAdditionalContextFragment } from '@lobechat/types';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../types';

export interface RuntimeAdditionalContextProviderConfig {
  additionalContexts?: readonly RuntimeAdditionalContextFragment[];
}

export class RuntimeAdditionalContextProvider extends BaseProcessor {
  readonly name = 'RuntimeAdditionalContextProvider';

  constructor(
    private config: RuntimeAdditionalContextProviderConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const fragments = this.config.additionalContexts;
    if (!fragments?.length) return this.markAsExecuted(context);

    const render = (placement: RuntimeAdditionalContextFragment['placement']) =>
      fragments
        .filter((fragment) => fragment.placement === placement)
        .map((fragment) => {
          const attributes = Object.entries(fragment.wrapper.attributes ?? {})
            .map(([key, value]) => ` ${key}="${escapeXmlAttr(value)}"`)
            .join('');
          const content =
            fragment.content.type === 'text'
              ? escapeXmlContent(fragment.content.text)
              : fragment.content.sections
                  .map((section) => {
                    const value =
                      section.format === 'text'
                        ? escapeXmlContent(String(section.value))
                        : JSON.stringify(
                            section.value,
                            null,
                            section.format === 'compact_json' ? undefined : 2,
                          )
                            .replaceAll('<', '\\u003c')
                            .replaceAll('>', '\\u003e');

                    return [`<${section.tag}>`, value, `</${section.tag}>`].join(
                      section.format === 'text' ? '' : '\n',
                    );
                  })
                  .join('\n');

          return [
            `<${fragment.wrapper.tag}${attributes}>`,
            content,
            `</${fragment.wrapper.tag}>`,
          ].join('\n');
        })
        .join('\n\n');

    const stableContent = render('stable_prefix');
    const tailContent = render('virtual_tail');
    if (!stableContent && !tailContent) return this.markAsExecuted(context);

    const clonedContext = this.cloneContext(context);

    if (stableContent) {
      const injectionIndex = clonedContext.messages.findIndex(
        (message) => message.meta?.systemInjection === true,
      );

      if (injectionIndex === -1) {
        const firstUserIndex = clonedContext.messages.findIndex(
          (message) =>
            message.role === 'user' &&
            message.meta?.systemInjection !== true &&
            message.meta?.virtualLastUser !== true,
        );

        if (firstUserIndex !== -1) {
          const now = Date.now();
          clonedContext.messages.splice(firstUserIndex, 0, {
            content: stableContent,
            createdAt: now,
            id: `system-injection-${now}`,
            meta: { systemInjection: true },
            role: 'user',
            updatedAt: now,
          });
        }
      } else {
        const message = clonedContext.messages[injectionIndex];

        clonedContext.messages[injectionIndex] = {
          ...message,
          content:
            typeof message.content === 'string'
              ? `${stableContent}\n\n${message.content}`
              : [{ text: stableContent, type: 'text' }, ...message.content],
          updatedAt: Date.now(),
        };
      }
    }

    if (tailContent) {
      const lastIndex = clonedContext.messages.length - 1;
      const lastMessage = clonedContext.messages[lastIndex];

      if (lastMessage?.role === 'user' && lastMessage.meta?.virtualLastUser === true) {
        clonedContext.messages[lastIndex] = {
          ...lastMessage,
          content:
            typeof lastMessage.content === 'string'
              ? `${lastMessage.content}\n\n${tailContent}`
              : [...lastMessage.content, { text: tailContent, type: 'text' }],
          updatedAt: Date.now(),
        };
      } else {
        const now = Date.now();
        clonedContext.messages.push({
          content: tailContent,
          createdAt: now,
          id: `virtual-last-user-${this.name}-${now}`,
          meta: { injectType: this.name, virtualLastUser: true },
          role: 'user',
          updatedAt: now,
        });
      }
    }

    return this.markAsExecuted(clonedContext);
  }
}
