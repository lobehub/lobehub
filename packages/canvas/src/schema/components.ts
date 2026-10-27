import type { CanvasAttributeSpec, CanvasComponentSpec } from './types';

export const CANVAS_TAG_PREFIX = 'lobe-';

export const CANVAS_PALETTE = [
  'red',
  'volcano',
  'orange',
  'gold',
  'yellow',
  'lime',
  'green',
  'cyan',
  'blue',
  'geekblue',
  'purple',
  'magenta',
  'gray',
] as const;

export const CANVAS_VALUE_FORMATS = ['number', 'compact', 'percent', 'currency'] as const;

export const CANVAS_CODE_LANGUAGES = [
  'bash',
  'c',
  'cpp',
  'csharp',
  'css',
  'diff',
  'dockerfile',
  'go',
  'html',
  'java',
  'javascript',
  'json',
  'jsx',
  'kotlin',
  'python',
  'ruby',
  'rust',
  'sql',
  'swift',
  'toml',
  'tsx',
  'typescript',
  'yaml',
] as const;

const size: CanvasAttributeSpec = {
  description: 'Control size.',
  type: 'enum',
  values: ['small', 'middle', 'large'],
};

const gap: CanvasAttributeSpec = { description: 'Gap between children in px.', type: 'number' };

const optionValue: CanvasAttributeSpec = {
  description: 'Value of the selected option; matches a child <lobe-option value>.',
  type: 'string',
};

const disabled: CanvasAttributeSpec = { description: 'Disable the control.', type: 'boolean' };

const chartAttributes: Record<string, CanvasAttributeSpec> = {
  'categories': {
    description: 'JSON array of the data keys to plot as series.',
    required: true,
    type: 'json',
  },
  'colors': {
    description: `JSON array of palette names, one per category: ${CANVAS_PALETTE.join(', ')}.`,
    type: 'json',
  },
  'data': {
    description: 'JSON array of row objects.',
    required: true,
    type: 'json',
  },
  'height': { description: 'Chart height in px. Default 280.', type: 'number' },
  'index': { description: 'Row key used for the x axis.', required: true, type: 'string' },
  'show-legend': { description: 'Show the legend. Default true.', type: 'boolean' },
  'unit': { description: 'Unit appended to formatted values, e.g. "ms".', type: 'string' },
  'value-format': {
    description: 'How values are formatted.',
    type: 'enum',
    values: CANVAS_VALUE_FORMATS,
  },
};

const chart = (
  tag: string,
  description: string,
  extra: Record<string, CanvasAttributeSpec> = {},
): CanvasComponentSpec => ({
  attributes: { ...chartAttributes, ...extra },
  category: 'chart',
  children: 'none',
  description,
  example: `<${tag} index="month" categories='["cost"]' data='[{"month":"Sep","cost":1200},{"month":"Oct","cost":1840}]'></${tag}>`,
  tag,
});

export const CANVAS_COMPONENTS: readonly CanvasComponentSpec[] = [
  {
    attributes: {
      align: {
        description: 'Cross-axis alignment.',
        type: 'enum',
        values: ['start', 'center', 'end', 'stretch', 'baseline'],
      },
      gap,
      horizontal: { description: 'Lay children out in a row.', type: 'boolean' },
      justify: {
        description: 'Main-axis distribution.',
        type: 'enum',
        values: ['start', 'center', 'end', 'space-between', 'space-around'],
      },
      wrap: { description: 'Wrap children onto new lines.', type: 'boolean' },
    },
    category: 'layout',
    children: 'content',
    description: 'Flex container. Vertical by default.',
    example: '<lobe-flex horizontal gap="12" align="center">…</lobe-flex>',
    tag: 'lobe-flex',
  },
  {
    attributes: {
      'gap': gap,
      'max-item-width': {
        description: 'Maximum item width in px before wrapping to more columns.',
        type: 'number',
      },
      'rows': { description: 'Number of columns.', type: 'number' },
    },
    category: 'layout',
    children: 'content',
    description: 'Responsive grid. Use for stat rows and card grids.',
    example: '<lobe-grid rows="3" gap="12">…</lobe-grid>',
    tag: 'lobe-grid',
  },
  {
    attributes: {
      padding: { description: 'Inner padding in px. Default 16.', type: 'number' },
      title: { description: 'Card title.', type: 'string' },
      variant: {
        description: 'Surface style.',
        type: 'enum',
        values: ['outlined', 'filled', 'borderless'],
      },
    },
    category: 'layout',
    children: 'content',
    description: 'Card surface that groups related content.',
    example: '<lobe-card title="By model">…</lobe-card>',
    tag: 'lobe-card',
  },
  {
    attributes: {
      dashed: { description: 'Dashed line.', type: 'boolean' },
    },
    category: 'layout',
    children: 'none',
    description: 'Horizontal divider between sections.',
    example: '<lobe-divider></lobe-divider>',
    tag: 'lobe-divider',
  },
  {
    attributes: {
      value: { description: 'Key of the active tab.', type: 'string' },
    },
    category: 'layout',
    children: 'options',
    description: 'Tabs. Each <lobe-tab> child is one panel.',
    example:
      '<lobe-tabs value="model"><lobe-tab value="model" label="By model">…</lobe-tab><lobe-tab value="team" label="By team">…</lobe-tab></lobe-tabs>',
    tag: 'lobe-tabs',
  },
  {
    attributes: {
      label: { description: 'Tab label.', required: true, type: 'string' },
      value: { description: 'Tab key.', required: true, type: 'string' },
    },
    category: 'layout',
    children: 'content',
    description: 'One tab panel inside <lobe-tabs>.',
    example: '<lobe-tab value="model" label="By model">…</lobe-tab>',
    parents: ['lobe-tabs'],
    tag: 'lobe-tab',
  },
  {
    attributes: {},
    category: 'layout',
    children: 'options',
    description: 'Collapsible sections. Each <lobe-accordion-item> child is one section.',
    example:
      '<lobe-accordion><lobe-accordion-item title="Method">…</lobe-accordion-item></lobe-accordion>',
    tag: 'lobe-accordion',
  },
  {
    attributes: {
      open: { description: 'Expanded by default.', type: 'boolean' },
      title: { description: 'Section title.', required: true, type: 'string' },
    },
    category: 'layout',
    children: 'content',
    description: 'One collapsible section inside <lobe-accordion>.',
    example: '<lobe-accordion-item title="Method" open>…</lobe-accordion-item>',
    parents: ['lobe-accordion'],
    tag: 'lobe-accordion-item',
  },
  {
    attributes: {
      title: { description: 'Bold first line.', type: 'string' },
      type: {
        description: 'Meaning of the message.',
        type: 'enum',
        values: ['info', 'success', 'warning', 'error'],
      },
    },
    category: 'text',
    children: 'content',
    description: 'Callout for a warning, a risk or a result the reader must not miss.',
    example: '<lobe-alert type="info" title="Cost is up 23%">Almost all from Opus.</lobe-alert>',
    tag: 'lobe-alert',
  },
  {
    attributes: {
      color: { description: 'Palette color.', type: 'enum', values: CANVAS_PALETTE },
    },
    category: 'text',
    children: 'content',
    description: 'Short label or status tag.',
    example: '<lobe-tag color="green">Stable</lobe-tag>',
    tag: 'lobe-tag',
  },
  {
    attributes: {
      count: { description: 'Number shown in the badge.', type: 'number' },
      status: {
        description: 'Status dot.',
        type: 'enum',
        values: ['success', 'processing', 'default', 'error', 'warning'],
      },
      text: { description: 'Text next to the status dot.', type: 'string' },
    },
    category: 'text',
    children: 'content',
    description: 'Status dot or count badge.',
    example: '<lobe-badge status="success" text="Healthy"></lobe-badge>',
    tag: 'lobe-badge',
  },
  {
    attributes: {
      language: {
        description: `Code language or a common alias (ts, js, py, sh). Highlighted: ${CANVAS_CODE_LANGUAGES.join(', ')}; any other shows as plain text.`,
        type: 'string',
      },
    },
    category: 'text',
    children: 'text',
    description:
      'Code block with syntax highlighting and a copy button. The code is the text content: write < as &lt; and & as &amp;.',
    example:
      '<lobe-code language="ts">const ids: Array&lt;string&gt; = rows.map((row) =&gt; row.id);</lobe-code>',
    tag: 'lobe-code',
  },
  {
    attributes: {},
    category: 'chart',
    children: 'text',
    description:
      'Diagram drawn from Mermaid text: flowchart, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, gantt, timeline, mindmap and the other Mermaid types. Use it for every flowchart, sequence or architecture diagram instead of drawing SVG by hand. The diagram is the text content: write < as &lt; and & as &amp;. Invalid Mermaid is rejected with the parser error.',
    example:
      '<lobe-mermaid>\nflowchart TD\n  A[Request] --&gt; B{Token valid?}\n  B -- yes --&gt; C[Response]\n  B -- no --&gt; D[Refresh]\n</lobe-mermaid>',
    tag: 'lobe-mermaid',
  },
  {
    attributes: {
      'precision': { description: 'Decimal places.', type: 'number' },
      'prefix': { description: 'Text before the value, e.g. "$".', type: 'string' },
      'suffix': { description: 'Text after the value, e.g. "%".', type: 'string' },
      'title': { description: 'Label above the value.', required: true, type: 'string' },
      'trend': {
        description:
          'Direction of change against an earlier value or a target, shown next to the value. Omit when there is no comparison.',
        type: 'enum',
        values: ['up', 'down', 'flat'],
      },
      'trend-text': { description: 'Change text, e.g. "+23% MoM".', type: 'string' },
      'value': { description: 'The number.', required: true, type: 'number' },
    },
    category: 'data',
    children: 'none',
    description: 'Key number with label and optional trend.',
    example:
      '<lobe-stat title="Total cost" value="18420" prefix="$" trend="up" trend-text="+23%"></lobe-stat>',
    tag: 'lobe-stat',
  },
  {
    attributes: {
      columns: {
        description:
          'JSON array of {"title","key","align"?:"left"|"right","format"?:"number"|"compact"|"percent"|"currency"}.',
        required: true,
        type: 'json',
      },
      data: { description: 'JSON array of row objects.', required: true, type: 'json' },
      striped: { description: 'Zebra rows.', type: 'boolean' },
    },
    category: 'data',
    children: 'none',
    description: 'Data table.',
    example:
      '<lobe-table columns=\'[{"title":"Model","key":"model"},{"title":"Cost","key":"cost","align":"right","format":"currency"}]\' data=\'[{"model":"Opus","cost":11236}]\'></lobe-table>',
    tag: 'lobe-table',
  },
  {
    attributes: {
      percent: { description: 'Progress 0–100.', required: true, type: 'number' },
      status: {
        description: 'Status color.',
        type: 'enum',
        values: ['normal', 'success', 'exception', 'active'],
      },
      type: { description: 'Shape.', type: 'enum', values: ['line', 'circle'] },
    },
    category: 'data',
    children: 'none',
    description: 'Progress bar or ring.',
    example: '<lobe-progress percent="61"></lobe-progress>',
    tag: 'lobe-progress',
  },
  {
    attributes: {
      items: {
        description:
          'JSON array of {"title","description"?,"status"?:"wait"|"process"|"finish"|"error"}. Set status only to track real progress.',
        required: true,
        type: 'json',
      },
      vertical: { description: 'Vertical timeline.', type: 'boolean' },
    },
    category: 'data',
    children: 'none',
    description: 'Ordered steps or a timeline.',
    example:
      '<lobe-steps vertical items=\'[{"title":"Collect usage"},{"title":"Compare plans"}]\'></lobe-steps>',
    tag: 'lobe-steps',
  },
  {
    attributes: {
      columns: { description: 'Items per row. Default 2.', type: 'number' },
      items: {
        description: 'JSON array of {"label","value"}.',
        required: true,
        type: 'json',
      },
    },
    category: 'data',
    children: 'none',
    description: 'Label/value pairs, e.g. metadata or a comparison.',
    example:
      '<lobe-descriptions items=\'[{"label":"Period","value":"Oct 2026"}]\'></lobe-descriptions>',
    tag: 'lobe-descriptions',
  },
  {
    attributes: {
      block: { description: 'Full width.', type: 'boolean' },
      disabled,
      size,
      type: {
        description: 'Visual weight.',
        type: 'enum',
        values: ['primary', 'default', 'text', 'link'],
      },
      value: { description: 'Value sent with the change event when clicked.', type: 'string' },
    },
    category: 'control',
    children: 'content',
    description: 'Button. Clicking fires lobe-change with its value.',
    example: '<lobe-button type="primary" value="refresh">Recalculate</lobe-button>',
    tag: 'lobe-button',
  },
  {
    attributes: {
      disabled,
      placeholder: { description: 'Placeholder text.', type: 'string' },
      size,
      value: optionValue,
    },
    category: 'control',
    children: 'options',
    description: 'Dropdown select with <lobe-option> children.',
    example:
      '<lobe-select id="range" value="30d"><lobe-option value="7d">7 days</lobe-option><lobe-option value="30d">30 days</lobe-option></lobe-select>',
    tag: 'lobe-select',
  },
  {
    attributes: { disabled, size, value: optionValue },
    category: 'control',
    children: 'options',
    description: 'Segmented switch between a few views, with <lobe-option> children.',
    example:
      '<lobe-segmented id="view" value="chart"><lobe-option value="chart">Chart</lobe-option><lobe-option value="table">Table</lobe-option></lobe-segmented>',
    tag: 'lobe-segmented',
  },
  {
    attributes: { disabled, value: optionValue },
    category: 'control',
    children: 'options',
    description: 'Radio group with <lobe-option> children.',
    example:
      '<lobe-radio-group value="a"><lobe-option value="a">A</lobe-option><lobe-option value="b">B</lobe-option></lobe-radio-group>',
    tag: 'lobe-radio-group',
  },
  {
    attributes: {
      disabled,
      value: { description: 'Option value.', required: true, type: 'string' },
    },
    category: 'control',
    children: 'content',
    description: 'One option inside a select, segmented or radio group. Text content is the label.',
    example: '<lobe-option value="7d">7 days</lobe-option>',
    parents: ['lobe-select', 'lobe-segmented', 'lobe-radio-group'],
    tag: 'lobe-option',
  },
  {
    attributes: {
      checked: { description: 'On by default.', type: 'boolean' },
      disabled,
      label: { description: 'Label next to the switch.', type: 'string' },
    },
    category: 'control',
    children: 'none',
    description: 'On/off switch.',
    example: '<lobe-switch id="cached" label="Include cached" checked></lobe-switch>',
    tag: 'lobe-switch',
  },
  {
    attributes: {
      checked: { description: 'Checked by default.', type: 'boolean' },
      disabled,
    },
    category: 'control',
    children: 'content',
    description: 'Checkbox. Text content is the label.',
    example: '<lobe-checkbox id="opus" checked>Opus</lobe-checkbox>',
    tag: 'lobe-checkbox',
  },
  {
    attributes: {
      disabled,
      placeholder: { description: 'Placeholder text.', type: 'string' },
      size,
      value: { description: 'Initial value.', type: 'string' },
    },
    category: 'control',
    children: 'none',
    description: 'Single-line text input.',
    example: '<lobe-input id="q" placeholder="Filter models"></lobe-input>',
    tag: 'lobe-input',
  },
  {
    attributes: {
      disabled,
      max: { description: 'Maximum. Default 100.', type: 'number' },
      min: { description: 'Minimum. Default 0.', type: 'number' },
      step: { description: 'Step. Default 1.', type: 'number' },
      value: { description: 'Initial value.', type: 'number' },
    },
    category: 'control',
    children: 'none',
    description: 'Slider for a numeric parameter.',
    example: '<lobe-slider id="share" min="0" max="100" value="40"></lobe-slider>',
    tag: 'lobe-slider',
  },
  chart('lobe-area-chart', 'Area chart for trends over time.', {
    stack: { description: 'Stack series.', type: 'boolean' },
  }),
  chart('lobe-bar-chart', 'Bar chart for comparing categories.', {
    layout: { description: 'Bar direction.', type: 'enum', values: ['horizontal', 'vertical'] },
    stack: { description: 'Stack series.', type: 'boolean' },
  }),
  chart('lobe-line-chart', 'Line chart for trends.'),
  {
    attributes: {
      'category': {
        description: 'Row key that groups points into series.',
        required: true,
        type: 'string',
      },
      'colors': chartAttributes.colors,
      'data': chartAttributes.data,
      'height': chartAttributes.height,
      'show-legend': chartAttributes['show-legend'],
      'size': { description: 'Row key that scales each point.', type: 'string' },
      'x': { description: 'Row key for the x value.', required: true, type: 'string' },
      'y': { description: 'Row key for the y value.', required: true, type: 'string' },
    },
    category: 'chart',
    children: 'none',
    description: 'Scatter chart for correlation between two measures.',
    example:
      '<lobe-scatter-chart x="latency" y="cost" category="model" data=\'[{"model":"Opus","latency":2.1,"cost":11}]\'></lobe-scatter-chart>',
    tag: 'lobe-scatter-chart',
  },
  chart('lobe-radar-chart', 'Radar chart for comparing a few items across several dimensions.'),
  {
    attributes: {
      'category': { description: 'Row key holding the value.', required: true, type: 'string' },
      'colors': chartAttributes.colors,
      'data': chartAttributes.data,
      'index': { description: 'Row key holding the slice name.', required: true, type: 'string' },
      'unit': chartAttributes.unit,
      'value-format': chartAttributes['value-format'],
      'variant': { description: 'Shape.', type: 'enum', values: ['donut', 'pie'] },
    },
    category: 'chart',
    children: 'none',
    description: 'Donut or pie chart for shares of a whole.',
    example:
      '<lobe-donut-chart index="model" category="cost" data=\'[{"model":"Opus","cost":61},{"model":"GPT","cost":22}]\'></lobe-donut-chart>',
    tag: 'lobe-donut-chart',
  },
  {
    attributes: {
      'data': {
        description: 'JSON array of {"name","value"}.',
        required: true,
        type: 'json',
      },
      'unit': chartAttributes.unit,
      'value-format': chartAttributes['value-format'],
    },
    category: 'chart',
    children: 'none',
    description: 'Ranked horizontal bars, best for top-N lists.',
    example: '<lobe-bar-list data=\'[{"name":"Code review","value":9870}]\'></lobe-bar-list>',
    tag: 'lobe-bar-list',
  },
  {
    attributes: {
      categories: chartAttributes.categories,
      colors: chartAttributes.colors,
      data: chartAttributes.data,
      index: chartAttributes.index,
      kind: { description: 'Shape.', type: 'enum', values: ['area', 'line', 'bar'] },
    },
    category: 'chart',
    children: 'none',
    description: 'Tiny inline trend chart without axes.',
    example:
      '<lobe-spark-chart kind="area" index="d" categories=\'["v"]\' data=\'[{"d":1,"v":3},{"d":2,"v":5}]\'></lobe-spark-chart>',
    tag: 'lobe-spark-chart',
  },
  {
    attributes: {
      data: {
        description: 'JSON array of {"color": palette name, "tooltip"?}.',
        required: true,
        type: 'json',
      },
    },
    category: 'chart',
    children: 'none',
    description: 'Row of status blocks, e.g. daily uptime.',
    example: '<lobe-tracker data=\'[{"color":"green","tooltip":"Oct 1"}]\'></lobe-tracker>',
    tag: 'lobe-tracker',
  },
  {
    attributes: {
      data: {
        description: 'JSON array of {"date":"YYYY-MM-DD","count"}.',
        required: true,
        type: 'json',
      },
    },
    category: 'chart',
    children: 'none',
    description: 'Calendar heatmap of daily activity.',
    example: '<lobe-heatmap data=\'[{"date":"2026-10-01","count":4}]\'></lobe-heatmap>',
    tag: 'lobe-heatmap',
  },
  {
    attributes: {
      data: {
        description: 'JSON array of {"name","value"} in funnel order.',
        required: true,
        type: 'json',
      },
    },
    category: 'chart',
    children: 'none',
    description: 'Funnel chart for conversion between stages.',
    example:
      '<lobe-funnel-chart data=\'[{"name":"Visit","value":1000},{"name":"Sign up","value":120}]\'></lobe-funnel-chart>',
    tag: 'lobe-funnel-chart',
  },
];

export const CANVAS_COMPONENT_MAP: ReadonlyMap<string, CanvasComponentSpec> = new Map(
  CANVAS_COMPONENTS.map((spec) => [spec.tag, spec]),
);

export const CANVAS_GLOBAL_ATTRIBUTES = new Set([
  'class',
  'hidden',
  'id',
  'role',
  'slot',
  'style',
  'title',
]);

export const isCanvasGlobalAttribute = (name: string): boolean =>
  CANVAS_GLOBAL_ATTRIBUTES.has(name) || name.startsWith('data-') || name.startsWith('aria-');
