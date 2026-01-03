import { escapeXmlAttr, escapeXmlContent } from '../search/xmlEscape';

export interface ModelResultItem {
  abilities?: {
    files?: boolean;
    functionCall?: boolean;
    reasoning?: boolean;
    vision?: boolean;
  };
  description?: string;
  id: string;
  name: string;
}

export interface ProviderResultItem {
  id: string;
  models: ModelResultItem[];
  name: string;
}

/**
 * Convert available models results to compact XML format for token efficiency
 *
 * @example
 * ```typescript
 * const providers = [
 *   { id: "openai", name: "OpenAI", models: [{ id: "gpt-4o", name: "GPT-4o", abilities: { vision: true } }] }
 * ];
 * const xml = modelsResultsPrompt(providers);
 * // Output:
 * // <availableModels>
 * //   <provider id="openai" name="OpenAI">
 * //     <model id="gpt-4o" name="GPT-4o" vision="true" />
 * //   </provider>
 * // </availableModels>
 * ```
 */
export const modelsResultsPrompt = (providers: ProviderResultItem[]): string => {
  if (providers.length === 0) return '<availableModels />';

  const providerItems = providers
    .map((provider) => {
      const providerAttrs = [
        `id="${escapeXmlAttr(provider.id)}"`,
        `name="${escapeXmlAttr(provider.name)}"`,
      ].join(' ');

      if (provider.models.length === 0) {
        return `  <provider ${providerAttrs} />`;
      }

      const modelItems = provider.models
        .map((model) => {
          const attrs: string[] = [
            `id="${escapeXmlAttr(model.id)}"`,
            `name="${escapeXmlAttr(model.name)}"`,
          ];

          // Add abilities as attributes if present
          if (model.abilities) {
            if (model.abilities.vision) attrs.push('vision="true"');
            if (model.abilities.functionCall) attrs.push('functionCall="true"');
            if (model.abilities.reasoning) attrs.push('reasoning="true"');
            if (model.abilities.files) attrs.push('files="true"');
          }

          const attrString = attrs.join(' ');
          const content = model.description ? escapeXmlContent(model.description) : '';

          return content
            ? `      <model ${attrString}>${content}</model>`
            : `      <model ${attrString} />`;
        })
        .join('\n');

      return `  <provider ${providerAttrs}>\n${modelItems}\n  </provider>`;
    })
    .join('\n');

  return `<availableModels>\n${providerItems}\n</availableModels>`;
};
