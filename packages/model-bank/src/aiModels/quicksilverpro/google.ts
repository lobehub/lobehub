import type { AIChatModelCard } from '../../types/aiModel';

// https://quicksilverpro.io/pricing.json — catalog v83 (2026-11-17), USD per 1M tokens.
export const googleChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'Gemini 4 Carbon',
    family: 'google',
    id: 'gemini-4-carbon',
    maxOutput: 65536,
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'Gemini 4 Argon',
    family: 'google',
    id: 'gemini-4-argon',
    maxOutput: 65536,
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'Gemini 3.7 Flash',
    family: 'google',
    id: 'gemini-3.7-flash',
    maxOutput: 65536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6375, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.06375, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.1875, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'Gemini 3.8 Flash',
    enabled: true,
    family: 'google',
    id: 'gemini-3.8-flash',
    maxOutput: 65536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6375, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.06375, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.1875, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'Gemini 3.6 Flash',
    family: 'google',
    id: 'gemini-3.6-flash',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6375, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.1875, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'Gemini 3.5 Flash-Lite',
    family: 'google',
    id: 'gemini-3.5-flash-lite',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.255, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.125, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'Gemini 3.5 Flash',
    family: 'google',
    id: 'gemini-3.5-flash',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.275, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7.65, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'Gemini 3.1 Pro Preview',
    family: 'google',
    id: 'gemini-3.1-pro-preview',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'Gemini 4 Hydrogen',
    family: 'google',
    id: 'gemini-4-hydrogen',
    maxOutput: 65536,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];
