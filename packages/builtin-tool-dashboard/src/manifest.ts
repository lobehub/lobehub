import type { BuiltinToolManifest } from '@lobechat/types';
import { DASHBOARD_WIDGET_RUNTIMES, WIDGET_OUTPUT_TYPES } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { DashboardApiName, DashboardIdentifier } from './types';

export { DashboardIdentifier } from './types';

const widgetIdSchema = {
  description: 'Widget id (uuid) returned by createWidgetDraft or listDashboards.',
  type: 'string',
};

const versionIdSchema = {
  description: "Version id (uuid). Omit to use the widget's current draft.",
  type: 'string',
};

const scriptSchema = {
  description:
    'The complete script. It must print exactly one JSON document matching outputType to stdout; logs go to stderr. Never embed secrets — read them from environment variables declared in manifest.env.',
  type: 'string',
};

const runtimeSchema = {
  description: 'node (global fetch, no npm packages), python (standard library only) or bash.',
  enum: [...DASHBOARD_WIDGET_RUNTIMES],
  type: 'string',
};

const outputTypeSchema = {
  description:
    'Shape of the JSON the script prints: stat (one number), list (items), series (time series), table (columns + rows).',
  enum: [...WIDGET_OUTPUT_TYPES],
  type: 'string',
};

const manifestSchema = {
  additionalProperties: false,
  description: 'What the script needs to run and how the platform treats its output.',
  properties: {
    env: {
      description:
        'Secrets / variables the script reads from its environment. Each is injected from a connected account (connector) at run time and redacted from logs.',
      items: {
        additionalProperties: false,
        properties: {
          connector: {
            description: 'Connector providing the value, e.g. "github", "linear".',
            type: 'string',
          },
          description: { type: 'string' },
          name: { description: 'Variable name, e.g. GITHUB_TOKEN.', type: 'string' },
          required: { type: 'boolean' },
        },
        required: ['name'],
        type: 'object',
      },
      type: 'array',
    },
    metric: {
      additionalProperties: false,
      description:
        "Record a stat's value on every published run for a long-term trend line. valuePath defaults to 'value'.",
      properties: {
        key: { type: 'string' },
        kind: { enum: ['gauge', 'counter'], type: 'string' },
        unit: { type: 'string' },
        valuePath: { type: 'string' },
      },
      required: ['key'],
      type: 'object',
    },
    network: {
      additionalProperties: false,
      description: 'Hostnames the script calls. Without it the sandbox has no network.',
      properties: { allow: { items: { type: 'string' }, type: 'array' } },
      required: ['allow'],
      type: 'object',
    },
    schedule: {
      additionalProperties: false,
      description:
        'Suggested refresh cadence, applied when the widget is published, e.g. {"pattern":"0 * * * *"}.',
      properties: {
        pattern: { description: '5-field cron pattern.', type: 'string' },
        timezone: { description: 'IANA timezone, e.g. Asia/Shanghai.', type: 'string' },
      },
      required: ['pattern'],
      type: 'object',
    },
    timeoutMs: {
      description: 'Script time limit in ms. Default 30000, max 120000.',
      type: 'number',
    },
  },
  type: 'object',
};

const viewSchema = {
  additionalProperties: false,
  description: 'Rendering hints for the card.',
  properties: {
    chart: { enum: ['line', 'bar', 'area'], type: 'string' },
    columns: {
      description: 'Table column keys to show, in order.',
      items: { type: 'string' },
      type: 'array',
    },
    limit: { description: 'Maximum list / table rows on the card.', type: 'number' },
  },
  type: 'object',
};

export const DashboardManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        "List the user's dashboards (in a project conversation, the project's dashboards first, then the home ones) with the widgets placed on them, plus the widgets this agent already owns (with publish and last-run status). Call before creating a widget to avoid duplicates and to pick a dashboard.",
      name: DashboardApiName.listDashboards,
      parameters: {
        additionalProperties: false,
        properties: {},
        type: 'object',
      },
    },
    {
      description:
        'Create a monitoring widget and save its first draft. Nothing runs and nothing goes live; call dryRunWidget next. The widget is owned by the current agent (and project, in a project conversation).',
      name: DashboardApiName.createWidgetDraft,
      parameters: {
        additionalProperties: false,
        properties: {
          description: {
            description:
              'Metric definition (口径) shown on the card: data source, filters, time window and unit.',
            type: 'string',
          },
          manifest: manifestSchema,
          outputType: outputTypeSchema,
          runtime: runtimeSchema,
          script: scriptSchema,
          title: { description: 'Short card title, e.g. "Open bug issues".', type: 'string' },
          view: viewSchema,
        },
        required: ['title', 'description', 'script', 'runtime', 'outputType'],
        type: 'object',
      },
    },
    {
      description:
        "Save a new draft of an existing widget. Omitted content fields keep the current draft's values, so send only what changes. title / description update the widget itself. Call dryRunWidget afterwards.",
      name: DashboardApiName.updateWidgetDraft,
      parameters: {
        additionalProperties: false,
        properties: {
          changeNote: {
            description: 'One line on what changed in this draft, shown in version history.',
            type: 'string',
          },
          description: {
            description: 'New metric definition (口径) when the logic changed.',
            type: 'string',
          },
          manifest: manifestSchema,
          outputType: outputTypeSchema,
          runtime: runtimeSchema,
          script: scriptSchema,
          title: { type: 'string' },
          view: viewSchema,
          widgetId: widgetIdSchema,
        },
        required: ['widgetId'],
        type: 'object',
      },
    },
    {
      description:
        'Execute a draft once in the sandbox and return its real output, stdout/stderr and error. Never affects the live widget. Fix the script with updateWidgetDraft and dry-run again until it succeeds.',
      name: DashboardApiName.dryRunWidget,
      parameters: {
        additionalProperties: false,
        properties: { versionId: versionIdSchema, widgetId: widgetIdSchema },
        required: ['widgetId'],
        type: 'object',
      },
      renderDisplayControl: 'expand',
    },
    {
      description:
        'Ask the user to publish a draft so it runs on its schedule. The user must confirm in the UI; the draft must have succeeded in a dry run with exactly this content.',
      humanIntervention: 'always',
      name: DashboardApiName.requestPublish,
      parameters: {
        additionalProperties: false,
        properties: {
          summary: {
            description: 'One sentence for the confirmation card: what goes live and why.',
            type: 'string',
          },
          versionId: versionIdSchema,
          widgetId: widgetIdSchema,
        },
        required: ['widgetId'],
        type: 'object',
      },
      renderDisplayControl: 'expand',
    },
    {
      description:
        'Place a widget on a dashboard. Pass dashboardId from listDashboards, or newDashboardTitle to create a dashboard first (in a project conversation it belongs to the project). Placing an unpublished widget is allowed.',
      name: DashboardApiName.addWidgetToDashboard,
      parameters: {
        additionalProperties: false,
        properties: {
          dashboardId: { description: 'Existing dashboard id (uuid).', type: 'string' },
          newDashboardTitle: {
            description: 'Create a new dashboard with this name and place the widget on it.',
            type: 'string',
          },
          widgetId: widgetIdSchema,
        },
        required: ['widgetId'],
        type: 'object',
      },
    },
    {
      description:
        "Recent runs of a widget (scheduled, manual and preview), newest first. Pass runId to get that run's full output and logs.",
      name: DashboardApiName.getWidgetRuns,
      parameters: {
        additionalProperties: false,
        properties: {
          limit: { description: 'How many runs to list (1-50, default 10).', type: 'number' },
          runId: { description: 'A run id to inspect in full.', type: 'string' },
          widgetId: widgetIdSchema,
        },
        required: ['widgetId'],
        type: 'object',
      },
    },
  ],
  identifier: DashboardIdentifier,
  meta: {
    avatar: '📊',
    description:
      'Build live monitoring widgets from sandboxed scripts, preview them with real data and put them on dashboards',
    title: 'Dashboards',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
