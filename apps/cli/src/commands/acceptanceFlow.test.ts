import { Command } from 'commander';
import { expect, it, vi } from 'vitest';

import { attachAcceptanceFlowCommands } from './acceptanceFlow';

const { startFlow, deleteFlow, confirm, outputJson } = vi.hoisted(() => ({
  startFlow: vi.fn().mockResolvedValue({ id: 'flow-run' }),
  deleteFlow: vi.fn().mockResolvedValue({ flowId: 'flow-id', title: 'First attempt' }),
  confirm: vi.fn().mockResolvedValue(false),
  outputJson: vi.fn(),
}));

vi.mock('../api/client', () => ({
  getTrpcClient: async () => ({
    acceptance: { startFlow: { mutate: startFlow }, deleteFlow: { mutate: deleteFlow } },
  }),
}));
vi.mock('../utils/format', () => ({ confirm, outputJson }));

it('starts the requested flow version without triggering the root CLI version option', async () => {
  const program = new Command().version('0.0.52').exitOverride();
  attachAcceptanceFlowCommands(program.command('acceptance'));
  await program.parseAsync([
    'node',
    'lh',
    'acceptance',
    'flow',
    'start',
    'acceptance-id',
    '--flow',
    'version-id',
    '--run',
    'verify-run',
  ]);
  expect(startFlow).toHaveBeenCalledWith({
    id: 'acceptance-id',
    flowId: 'version-id',
    sourceRunId: undefined,
    verifyRunId: 'verify-run',
  });
  expect(outputJson).toHaveBeenCalledWith({ id: 'flow-run' });
});

it('allows a fresh verification round when --run is omitted', async () => {
  startFlow.mockClear();
  const program = new Command().exitOverride();
  attachAcceptanceFlowCommands(program.command('acceptance'));
  await program.parseAsync([
    'node',
    'lh',
    'acceptance',
    'flow',
    'start',
    'acceptance-id',
    '--flow',
    'version-id',
  ]);
  expect(startFlow).toHaveBeenCalledWith({
    id: 'acceptance-id',
    flowId: 'version-id',
    sourceRunId: undefined,
    verifyRunId: undefined,
  });
});

it('prepares a flow for review through the plan command', async () => {
  startFlow.mockClear();
  const program = new Command().exitOverride();
  attachAcceptanceFlowCommands(program.command('acceptance'));
  await program.parseAsync([
    'node',
    'lh',
    'acceptance',
    'flow',
    'plan',
    'acceptance-id',
    '--flow',
    'flow-id',
  ]);
  expect(startFlow).toHaveBeenCalledWith({
    id: 'acceptance-id',
    flowId: 'flow-id',
    sourceRunId: undefined,
    verifyRunId: undefined,
  });
});

it('asks before deleting a flow and passes the confirmed request through', async () => {
  const deleteArgs = [
    'node',
    'lh',
    'acceptance',
    'flow',
    'delete',
    'acceptance-id',
    '--flow',
    'flow-id',
  ];
  const program = new Command().exitOverride();
  attachAcceptanceFlowCommands(program.command('acceptance'));
  await program.parseAsync(deleteArgs);
  expect(confirm).toHaveBeenCalled();
  expect(deleteFlow).not.toHaveBeenCalled();

  const confirmed = new Command().exitOverride();
  attachAcceptanceFlowCommands(confirmed.command('acceptance'));
  await confirmed.parseAsync([...deleteArgs, '--yes']);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(deleteFlow).toHaveBeenCalledWith({ id: 'acceptance-id', flowId: 'flow-id' });
});
