import { type LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';

import { safeParseJSON } from '@/utils/safeParseJSON';

// （McpConfig, McpServers, ParsedMcpInput 接口定义保持不变）
interface McpConfig {
  args?: string[];
  command?: string;
  url?: string;
}

interface McpServers {
  [key: string]: McpConfig;
}

interface ParsedMcpInput {
  manifest?: LobeChatPluginManifest;
  mcpServers?: McpServers;
}

// 移除 DuplicateIdentifier
export enum McpParseErrorCode {
  EmptyMcpServers = 'EmptyMcpServers',
  InvalidJsonStructure = 'InvalidJsonStructure',
  InvalidMcpStructure = 'InvalidMcpStructure',
  ManifestNotSupported = 'ManifestNotSupported',
}

// 移除 isDuplicate
interface ParseSuccessResult {
  identifier: string;
  mcpConfig: McpConfig & { type: 'stdio' | 'http' };
  status: 'success';
}

interface ParseErrorResult {
  errorCode: McpParseErrorCode;
  // identifier 字段仍然可能有用，用于在结构错误时也能显示用户输入的 ID
  identifier?: string;
  status: 'error';
}

interface ParseNoOpResult {
  status: 'noop';
}

export type ParseResult = ParseSuccessResult | ParseErrorResult | ParseNoOpResult;

export const parseMcpInput = (value: string): ParseResult => {
  const parsedJson = safeParseJSON<ParsedMcpInput | McpServers>(value);

  if (parsedJson && typeof parsedJson === 'object' && !Array.isArray(parsedJson)) {
    // 1. Check for the nested "mcpServers" structure
    if (
      'mcpServers' in parsedJson &&
      typeof parsedJson.mcpServers === 'object' &&
      parsedJson.mcpServers !== null
    ) {
      const mcpKeys = Object.keys(parsedJson.mcpServers);

      if (mcpKeys.length > 0) {
        const identifier = mcpKeys[0];
        // @ts-expect-error type 不一样
        const mcpConfig = parsedJson.mcpServers[identifier];

        if (mcpConfig && typeof mcpConfig === 'object' && !Array.isArray(mcpConfig)) {
          let type: 'stdio' | 'http' | undefined;
          let resultMcpConfig: McpConfig & { type?: 'stdio' | 'http' } = {};

          if (mcpConfig.command && Array.isArray(mcpConfig.args)) {
            type = 'stdio';
            resultMcpConfig = { ...mcpConfig, type };
          } else if (mcpConfig.url) {
            type = 'http';
            resultMcpConfig = { type, url: mcpConfig.url };
          } else {
            return {
              errorCode: McpParseErrorCode.InvalidMcpStructure,
              identifier,
              status: 'error',
            };
          }

          return {
            identifier,
            mcpConfig: resultMcpConfig as McpConfig & { type: 'stdio' | 'http' },
            status: 'success',
          };
        }
        // mcpConfig is invalid or not an object
        return {
          errorCode: McpParseErrorCode.InvalidMcpStructure,
          identifier: identifier,
          status: 'error',
        };
      } else {
        // mcpServers object is empty
        return { errorCode: McpParseErrorCode.EmptyMcpServers, status: 'error' };
      }
    }
    // 3. Check for the flat structure (identifier as top-level key)
    else {
      const topLevelKeys = Object.keys(parsedJson);

      // Allow exactly one top-level key which is the identifier
      if (topLevelKeys.length === 1) {
        const identifier = topLevelKeys[0];
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        const mcpConfig = (parsedJson as any)[identifier];

        if (mcpConfig && typeof mcpConfig === 'object' && !Array.isArray(mcpConfig)) {
          let type: 'stdio' | 'http' | undefined;
          let resultMcpConfig: McpConfig & { type?: 'stdio' | 'http' } = {};

          // Explicitly check properties of mcpConfig
          if (mcpConfig.command && Array.isArray(mcpConfig.args)) {
            type = 'stdio';
            resultMcpConfig = { ...mcpConfig, type };
          } else if (mcpConfig.url) {
            type = 'http';
            // For the flat structure, ensure only 'url' is included for http type
            resultMcpConfig = { type, url: mcpConfig.url };
          } else {
            // Invalid structure within the identifier's value
            return {
              errorCode: McpParseErrorCode.InvalidMcpStructure,
              identifier, // We have the identifier here
              status: 'error',
            };
          }

          // Structure parsed successfully
          return {
            identifier,
            mcpConfig: resultMcpConfig as McpConfig & { type: 'stdio' | 'http' },
            status: 'success',
          };
        } else {
          // The value associated with the single key is not a valid config object
          return { errorCode: McpParseErrorCode.InvalidMcpStructure, identifier, status: 'error' };
        }
      } else {
        // Neither mcpServers nor manifest, and not a single top-level key structure
        return { errorCode: McpParseErrorCode.InvalidJsonStructure, status: 'error' };
      }
    }
  }

  // Input is not a valid JSON object or failed safeParseJSON
  return { status: 'noop' }; // Or potentially InvalidJsonStructure if safeParse failed but wasn't null/undefined?
};
