'use client';

import { listBuiltinInspectorEntries } from '@lobechat/builtin-tools/inspectors';
import { listBuiltinInterventionEntries } from '@lobechat/builtin-tools/interventions';
import { listBuiltinPlaceholderEntries } from '@lobechat/builtin-tools/placeholders';
import { listBuiltinRenderEntries } from '@lobechat/builtin-tools/renders';
import { listBuiltinStreamingEntries } from '@lobechat/builtin-tools/streamings';
import type {
  BuiltinInspector,
  BuiltinIntervention,
  BuiltinPlaceholder,
  BuiltinRender,
  BuiltinStreaming,
} from '@lobechat/types';
import type { MenuProps } from '@lobehub/ui';
import { useMemo } from 'react';

import {
  getToolRenderFixture,
  getToolRenderMeta,
  type ToolRenderFixture,
} from './toolRenderFixtures';

export interface ApiEntry {
  apiName: string;
  description?: string;
  fixture: ToolRenderFixture;
  identifier: string;
  inspector?: BuiltinInspector;
  intervention?: BuiltinIntervention;
  placeholder?: BuiltinPlaceholder;
  render?: BuiltinRender;
  streaming?: BuiltinStreaming;
}

export interface ToolsetEntry {
  apis: ApiEntry[];
  identifier: string;
  toolsetDescription?: string;
  toolsetName: string;
}

export interface DevtoolsEntries {
  defaultToolset?: ToolsetEntry;
  menuItems: MenuProps['items'];
  toolsetMap: Map<string, ToolsetEntry>;
}

export const toToolsetPath = (identifier: string) => `/devtools/${encodeURIComponent(identifier)}`;

export const toApiAnchor = (apiName: string) => `api-${apiName}`;

export const useDevtoolsEntries = (): DevtoolsEntries =>
  useMemo(() => {
    const pairKey = (identifier: string, apiName: string) => `${identifier}:${apiName}`;

    const byKey = new Map<
      string,
      {
        apiName: string;
        identifier: string;
        inspector?: BuiltinInspector;
        intervention?: BuiltinIntervention;
        placeholder?: BuiltinPlaceholder;
        render?: BuiltinRender;
        streaming?: BuiltinStreaming;
      }
    >();

    const upsert = (
      identifier: string,
      apiName: string,
      patch: Partial<
        Pick<ApiEntry, 'inspector' | 'intervention' | 'placeholder' | 'render' | 'streaming'>
      >,
    ) => {
      const key = pairKey(identifier, apiName);
      const existing = byKey.get(key);
      if (existing) {
        byKey.set(key, { ...existing, ...patch });
      } else {
        byKey.set(key, { apiName, identifier, ...patch });
      }
    };

    for (const entry of listBuiltinRenderEntries()) {
      upsert(entry.identifier, entry.apiName, { render: entry.render });
    }
    for (const entry of listBuiltinInspectorEntries()) {
      upsert(entry.identifier, entry.apiName, { inspector: entry.inspector });
    }
    for (const entry of listBuiltinStreamingEntries()) {
      upsert(entry.identifier, entry.apiName, { streaming: entry.streaming });
    }
    for (const entry of listBuiltinPlaceholderEntries()) {
      upsert(entry.identifier, entry.apiName, { placeholder: entry.placeholder });
    }
    for (const entry of listBuiltinInterventionEntries()) {
      upsert(entry.identifier, entry.apiName, { intervention: entry.intervention });
    }

    const toolsetMap = new Map<string, ToolsetEntry>();

    for (const {
      apiName,
      identifier,
      inspector,
      intervention,
      placeholder,
      render,
      streaming,
    } of byKey.values()) {
      const meta = getToolRenderMeta(identifier, apiName);
      const fixture = getToolRenderFixture(identifier, apiName, meta.api);

      const api: ApiEntry = {
        apiName,
        description: meta.description,
        fixture,
        identifier,
        inspector,
        intervention,
        placeholder,
        render,
        streaming,
      };

      const toolset = toolsetMap.get(identifier);
      if (toolset) {
        toolset.apis.push(api);
      } else {
        toolsetMap.set(identifier, {
          apis: [api],
          identifier,
          toolsetDescription: meta.toolsetDescription,
          toolsetName: meta.toolsetName,
        });
      }
    }

    for (const toolset of toolsetMap.values()) {
      toolset.apis.sort((left, right) => left.apiName.localeCompare(right.apiName));
    }

    const toolsets = [...toolsetMap.values()].sort((left, right) =>
      left.toolsetName.localeCompare(right.toolsetName),
    );

    const menuItems: MenuProps['items'] = toolsets.map((toolset) => ({
      key: toolset.identifier,
      label: toolset.toolsetName,
    }));

    return {
      defaultToolset: toolsets[0],
      menuItems,
      toolsetMap,
    };
  }, []);
