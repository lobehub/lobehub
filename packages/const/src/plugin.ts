export const PLUGIN_SCHEMA_SEPARATOR = '____';
export const PLUGIN_SCHEMA_API_MD5_PREFIX = 'MD5HASH_';

export const ARTIFACT_TAG = 'lobeArtifact';
export const ARTIFACT_THINKING_TAG = 'lobeThinking';
export const MENTION_TAG = 'mention';
export const THINKING_TAG = 'think';
export const LOCAL_FILE_TAG = 'localFile';
// https://regex101.com/r/TwzTkf/2
export const ARTIFACT_TAG_REGEX = /<lobeArtifact\b[^>]*>(?<content>[\S\s]*?)(?:<\/lobeArtifact>|$)/;

// https://regex101.com/r/r9gqGg/1
export const ARTIFACT_TAG_CLOSED_REGEX = /<lobeArtifact\b[^>]*>([\S\s]*?)<\/lobeArtifact>/;

// https://regex101.com/r/AvPA2g/1
export const ARTIFACT_THINKING_TAG_REGEX = /<lobeThinking\b[^>]*>([\S\s]*?)(?:<\/lobeThinking>|$)/;

export const THINKING_TAG_REGEX = /<think\b[^>]*>([\S\s]*?)(?:<\/think>|$)/;

export const MENTION_TAG_REGEX = /<mention\b[^>]*>([\S\s]*?)(?:<\/mention>|$)/;
