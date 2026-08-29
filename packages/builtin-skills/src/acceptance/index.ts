import type { BuiltinSkill } from '@lobechat/types';

import { readSkillVersion, toResourceMeta } from '../lobehub/helpers';
import agentBrowser from './references/agent-browser.md';
import authWeb from './references/auth-web.md';
import commonMistakes from './references/common-mistakes.md';
import computerUse from './references/computer-use.md';
import evidence from './references/evidence.md';
import interactionCost from './references/interaction-cost.md';
import planFormat from './references/plan-format.md';
import probeMockPatterns from './references/probe-mock-patterns.md';
import projectAdapter from './references/project-adapter.md';
import recordingCdp from './references/recording-cdp.md';
import recordingIosSimulator from './references/recording-ios-simulator.md';
import recordingNativeMacos from './references/recording-native-macos.md';
import report from './references/report.md';
import content from './SKILL.md';
import cli from './surfaces/cli.md';
import electron from './surfaces/electron.md';
import iosSimulator from './surfaces/ios-simulator.md';
import native from './surfaces/native.md';
import web from './surfaces/web.md';

export const AcceptanceIdentifier = 'acceptance';

/**
 * The single builder-side acceptance skill: discover or author the plan → pick a
 * surface → capture evidence per criterion → publish a round → self-check
 * coverage. It runs from any task's working directory, with or without a LobeHub
 * operation/topic, and depends on no repository-local script. Surface-specific
 * tools stay explicit: agent-browser for Web/Electron, shell-level native
 * automation for macOS, and an installed Simulator HID/Accessibility CLI plus
 * Xcode/simctl for iOS.
 *
 * Everything a specific repository needs on top — its start/stop commands, its
 * approval gate and teardown, its own living logs and probe scripts — lives in
 * that repository's `.agents/acceptance/` project layer, which SKILL.md reads
 * first. This split replaced the former repo-local `agent-testing` skill: the
 * contract is here, the repository's process is there, and neither restates the
 * other.
 *
 * The references carry the shared contracts and surface-scoped operating
 * manuals. Authentication and recording resources are split by runtime so a
 * selected surface never needs to load another platform's instructions.
 *
 * Resource keys keep the `.md` extension so a disk pull
 * (`.agents/skills/acceptance/references/*.md`) maps 1:1 to real files and the
 * in-SKILL relative links resolve.
 *
 * `version` is read from SKILL.md's own frontmatter rather than declared here,
 * so there is one place to bump and an installed copy on disk always states the
 * version it carries. Bump it whenever a change alters what a builder must DO —
 * a new required step, a changed contract or vocabulary, a moved reference —
 * not for a typo or a reworded sentence.
 */
export const AcceptanceSkill: BuiltinSkill = {
  avatar: '✅',
  content,
  description:
    'End-to-end verification and self-evidence for a delivery in any repository, with or without a LobeHub operation or verify plan — discover or author checks, drive CLI, web, desktop, or iOS Simulator on the correct surface, capture visually confirmed evidence, and publish a standalone or subject-linked acceptance round. Reads the repository’s own `.agents/acceptance/` project layer when one exists.',
  identifier: AcceptanceIdentifier,
  name: 'acceptance',
  resources: toResourceMeta({
    'references/agent-browser.md': agentBrowser,
    'references/common-mistakes.md': commonMistakes,
    'references/auth-web.md': authWeb,
    'references/computer-use.md': computerUse,
    'references/evidence.md': evidence,
    'references/interaction-cost.md': interactionCost,
    'references/plan-format.md': planFormat,
    'references/probe-mock-patterns.md': probeMockPatterns,
    'references/project-adapter.md': projectAdapter,
    'references/recording-cdp.md': recordingCdp,
    'references/recording-ios-simulator.md': recordingIosSimulator,
    'references/recording-native-macos.md': recordingNativeMacos,
    'references/report.md': report,
    'surfaces/cli.md': cli,
    'surfaces/electron.md': electron,
    'surfaces/ios-simulator.md': iosSimulator,
    'surfaces/native.md': native,
    'surfaces/web.md': web,
  }),
  source: 'builtin',
  version: readSkillVersion(content),
};
