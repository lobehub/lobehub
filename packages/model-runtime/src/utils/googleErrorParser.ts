import type { ILobeAgentRuntimeErrorType } from '../types/error';
import { AgentRuntimeErrorType } from '../types/error';

export interface ParsedError {
  error: any;
  errorType: ILobeAgentRuntimeErrorType;
}

export interface GoogleChatError {
  '@type': string;
  'domain': string;
  'metadata': {
    service: string;
  };
  'reason': string;
}

export type GoogleChatErrors = GoogleChatError[];

/**
 * Clean error message by removing formatting characters and extra spaces
 * @param message - Original error message
 * @returns Cleaned error message
 */
export function cleanErrorMessage(message: string): string {
  return message
    .replaceAll(/^\*\s*/g, '') // Remove leading asterisks and spaces
    .replaceAll('\\n', '\n') // Convert escaped newlines
    .replaceAll(/\n+/g, ' ') // Replace multiple newlines with single space
    .trim(); // Trim leading/trailing spaces
}

/**
 * Extract status code information from error message
 * @param message - Error message
 * @returns Extracted error details and prefix
 */
export function extractStatusCodeFromError(message: string): {
  errorDetails: any;
  prefix: string;
} {
  // Match status code pattern [number description text]
  // Use string methods instead of regex to avoid ReDoS attacks
  // We need to find a bracket that contains a status code (3-digit number followed by space and text)

  let searchStart = 0;

  while (true) {
    const openBracketIndex = message.indexOf('[', searchStart);
    if (openBracketIndex === -1) {
      return { errorDetails: null, prefix: message };
    }

    const closeBracketIndex = message.indexOf(']', openBracketIndex);
    if (closeBracketIndex === -1) {
      return { errorDetails: null, prefix: message };
    }

    const bracketContent = message.slice(openBracketIndex + 1, closeBracketIndex).trim();

    // Find the first space to separate status code from description
    const spaceIndex = bracketContent.indexOf(' ');
    if (spaceIndex !== -1) {
      const statusCodeStr = bracketContent.slice(0, spaceIndex);
      const statusCode = parseInt(statusCodeStr, 10);

      // Validate that statusCode is a valid HTTP status code (3 digits)
      if (!isNaN(statusCode) && statusCode >= 100 && statusCode < 600) {
        const statusText = bracketContent.slice(spaceIndex + 1).trim();
        const prefix = message.slice(0, openBracketIndex).trim();
        const messageContent = message.slice(closeBracketIndex + 1).trim();

        // Create JSON containing status code and message
        const resultJson = {
          message: messageContent,
          statusCode: statusCode,
          statusCodeText: `[${statusCode} ${statusText}]`,
        };

        return {
          errorDetails: resultJson,
          prefix: prefix,
        };
      }
    }

    // Move to next bracket
    searchStart = openBracketIndex + 1;
  }
}

/**
 * Parse error message from Google AI API
 * @param message - Original error message
 * @returns Parsed error object and error type
 */
export function parseGoogleErrorMessage(message: string): ParsedError {
  const defaultError = {
    error: { message },
    errorType: AgentRuntimeErrorType.ProviderBizError,
  };

  // Quick identification of special errors
  if (message.includes('location is not supported')) {
    return { error: { message }, errorType: AgentRuntimeErrorType.LocationNotSupportError };
  }

  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes('no image generated') || lowerMessage.includes('no image data')) {
    return { error: { message }, errorType: AgentRuntimeErrorType.ProviderNoImageGenerated };
  }

  // Unified error type determination function
  const getErrorType = (code: number | null, message: string): ILobeAgentRuntimeErrorType => {
    if (code === 400 && message.includes('API key not valid')) {
      return AgentRuntimeErrorType.InvalidProviderAPIKey;
    } else if (code === 429) {
      return AgentRuntimeErrorType.QuotaLimitReached;
    }
    return AgentRuntimeErrorType.ProviderBizError;
  };

  // Recursively parse JSON, handling nested JSON strings
  const parseJsonRecursively = (str: string, maxDepth: number = 5): any => {
    if (maxDepth <= 0) return null;

    try {
      const parsed = JSON.parse(str);

      // If parsed object contains error field
      if (parsed && typeof parsed === 'object' && parsed.error) {
        const errorInfo = parsed.error;

        // Clean error message
        if (typeof errorInfo.message === 'string') {
          errorInfo.message = cleanErrorMessage(errorInfo.message);

          // If error.message is still a JSON string, continue recursive parsing
          try {
            const nestedResult = parseJsonRecursively(errorInfo.message, maxDepth - 1);
            // Only return deeper result if it contains an error object with code
            if (nestedResult && nestedResult.error && nestedResult.error.code) {
              return nestedResult;
            }
          } catch {
            // If nested parsing fails, use current layer info
          }
        }

        return parsed;
      }

      return parsed;
    } catch {
      return null;
    }
  };

  // 1. Handle "got status: UNAVAILABLE. {JSON}" format
  const statusPrefix = 'got status: ';
  const statusPrefixIndex = message.indexOf(statusPrefix);
  if (statusPrefixIndex !== -1) {
    const afterPrefix = message.slice(statusPrefixIndex + statusPrefix.length);
    const dotIndex = afterPrefix.indexOf('.');
    if (dotIndex !== -1) {
      const statusFromMessage = afterPrefix.slice(0, dotIndex).trim();
      const afterDot = afterPrefix.slice(dotIndex + 1).trim();
      const braceIndex = afterDot.indexOf('{');
      if (braceIndex !== -1) {
        const jsonPart = afterDot.slice(braceIndex);

        const parsedError = parseJsonRecursively(jsonPart);
        if (parsedError && parsedError.error) {
          const errorInfo = parsedError.error;
          const finalMessage = errorInfo.message || message;
          const finalCode = errorInfo.code || null;
          const finalStatus = errorInfo.status || statusFromMessage;

          return {
            error: {
              code: finalCode,
              message: finalMessage,
              status: finalStatus,
            },
            errorType: getErrorType(finalCode, finalMessage),
          };
        }
      }
    }
  }

  // 2. Try to parse entire message as JSON directly
  const directParsed = parseJsonRecursively(message);
  if (directParsed && directParsed.error) {
    const errorInfo = directParsed.error;
    const finalMessage = errorInfo.message || message;
    const finalCode = errorInfo.code || null;
    const finalStatus = errorInfo.status || '';

    return {
      error: {
        code: finalCode,
        message: finalMessage,
        status: finalStatus,
      },
      errorType: getErrorType(finalCode, finalMessage),
    };
  }

  // 3. Handle nested JSON format, especially when message field contains JSON
  try {
    const firstLevelParsed = JSON.parse(message);
    if (firstLevelParsed && firstLevelParsed.error && firstLevelParsed.error.message) {
      const nestedParsed = parseJsonRecursively(firstLevelParsed.error.message);
      if (nestedParsed && nestedParsed.error) {
        const errorInfo = nestedParsed.error;
        const finalMessage = errorInfo.message || message;
        const finalCode = errorInfo.code || null;
        const finalStatus = errorInfo.status || '';

        return {
          error: {
            code: finalCode,
            message: finalMessage,
            status: finalStatus,
          },
          errorType: getErrorType(finalCode, finalMessage),
        };
      }
    }
  } catch {
    // Continue with other parsing methods
  }

  // 4. Original array format parsing logic
  const startIndex = message.lastIndexOf('[');
  if (startIndex !== -1) {
    try {
      const jsonString = message.slice(startIndex);
      const json: GoogleChatErrors = JSON.parse(jsonString);
      const bizError = json[0];

      if (bizError?.reason === 'API_KEY_INVALID') {
        return { ...defaultError, errorType: AgentRuntimeErrorType.InvalidProviderAPIKey };
      }

      return { error: json, errorType: AgentRuntimeErrorType.ProviderBizError };
    } catch {
      // Ignore parsing errors
    }
  }

  // 5. Use status code extraction logic as last fallback
  const errorObj = extractStatusCodeFromError(message);
  if (errorObj.errorDetails) {
    return { error: errorObj.errorDetails, errorType: AgentRuntimeErrorType.ProviderBizError };
  }

  return defaultError;
}
