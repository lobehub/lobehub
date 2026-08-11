export default {
  'anchor.pending': 'Waiting for you to pick a direction',
  'anchor.pendingDesc':
    'A domain is a choice, not a discovery — the same agent can be anchored two different ways and both are correct. Pick one before it starts building rules.',
  'anchor.tag': 'Direction not picked',

  'chart.actual': 'Learned so far',
  'chart.bars': 'Bars are the rules learned in that round; the line is the running total.',
  'chart.newRules': 'New that round',
  'chart.projection': 'Projection',
  'chart.speculative':
    'The projection is a guess for now — only {{span}} of one time constant observed, so the curve has not turned yet and the ceiling is not pinned down by the data.',
  'chart.title': 'Rules learned per practice',
  'chart.trustworthy':
    'At this pace, about {{remaining}} more practices to reach 90% (around #{{run}}). {{span}} time constants observed.',

  'empty.desc':
    'Rules cannot be written from theory. Let it do real work first and keep the places it got wrong — those are what can be taught.',
  'empty.title': 'It has not learned anything yet',

  'layers.blank': 'nothing yet',
  'layers.blankDesc':
    'A blank layer is a finding, not a defect: the agent has simply never been tested at this layer.',
  'layers.count': '{{count}} rules',
  'layers.fromCanon': 'Layers from {{source}}',
  'layers.invented': 'Layers made up — no canonical model',
  'layers.title': 'Which layers it learns at',
  'layers.unanchored': '{{count}} rules are not anchored to any canonical entry.',

  'maturity.lowConfidence': 'Cannot be computed yet',
  'maturity.lowConfidenceDesc':
    'Too few samples or the curve is too noisy to fit ({{kind}}) — better no number than a made-up one.',
  'maturity.noData': 'Never practised',
  'maturity.noDataDesc': 'Maturity needs practice runs to compute. There are none yet.',
  'maturity.pending': 'Computing',
  'maturity.pendingDesc': 'The fit runs on a schedule; the number shows up after the next pass.',
  'maturity.speculativeTag': 'speculative',
  'maturity.title': 'Maturity',
  'maturity.unbounded': 'Ceiling not bounded yet',
  'maturity.unboundedDesc':
    'The fitted time constant hit the search ceiling — the curve is still in its straight stretch, so any percentage would be an artifact of the bound rather than a fact.',
  'maturity.value': '{{learned}} learned, estimated ceiling {{ceiling}}',

  'rules.coreHint': 'used in almost every practice',
  'rules.hits': 'used {{count}} times',
  'rules.neverUsed': 'never used',
  'rules.nicheHint': 'only fires in specific situations',
  'rules.tier.core': 'Backbone',
  'rules.tier.niche': 'Situational',
  'rules.tier.unused': 'Never used',
  'rules.title': 'What it has learned',
  'rules.unanchored': 'no anchor',
  'rules.unanchoredDesc':
    'Not anchored to any canonical entry — usually a sign it has not been thought through yet, not that it is wrong.',
  'rules.unusedHint': 'practised many times and never fired — a rare case, or not a rule at all?',

  'summary.lessons': '{{count}} rules',
  'summary.practices': 'practised {{count}} times',

  'title': 'Self-evolving',
};
