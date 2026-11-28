/** The SDK host default, shared with durable client calls; preserve valid configured budgets. */
export const getMcpToolTimeoutMs = () => {
  const value = Number(process.env.MCP_TOOL_TIMEOUT);
  return Number.isFinite(value) && value > 0 ? value : 60_000;
};
