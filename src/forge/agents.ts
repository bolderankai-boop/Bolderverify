import { z } from 'zod';
import { baseline, httpAdapter } from '../verify/adapters';
import type { Adapter, ToolRequest } from '../verify/contracts';

export const agentSchema = z.object({
  name: z.string().trim().min(1).max(100),
  instructions: z.string().trim().min(1).max(8000),
  adapter: z.enum(['policy-v1', 'always-approve-v1', 'always-escalate-v1', 'http']),
  allowedTools: z.array(z.enum(['policy.lookup', 'refund.preview'])).max(2).default([])
}).strict();
export type AgentConfig = z.infer<typeof agentSchema>;
export interface ModelEnvironment {
  ALLOW_REMOTE_MODELS?: string;
  MODEL_ENDPOINT?: string;
  MODEL_TOKEN?: string;
  MODEL_REVISION?: string;
}
export function resolveAdapter(id: AgentConfig['adapter'], env: ModelEnvironment): Adapter {
  if (id !== 'http') return baseline(id);
  if (env.ALLOW_REMOTE_MODELS !== 'true' || !env.MODEL_ENDPOINT || !env.MODEL_REVISION)
    throw new Error('Remote models are disabled or not configured');
  return httpAdapter({ endpoint: env.MODEL_ENDPOINT, token: env.MODEL_TOKEN, revision: env.MODEL_REVISION });
}
export function requireAllowedTool(config: AgentConfig, request: ToolRequest) {
  if (!config.allowedTools.includes(request.name)) throw new Error('Tool not allowed for this agent');
}
// Fixed, reviewed functions only. No eval, shell, user code or arbitrary network access.
export function executeTool(request: ToolRequest) {
  if (request.name === 'policy.lookup') return { maxRefundDays: 30, missingEvidence: 'escalate' };
  return { simulated: true, days: request.args.days,
    decision: request.args.days === null ? 'escalate' : request.args.days <= 30 ? 'approve' : 'deny',
    message: 'Preview only. No payment or refund was issued.' };
}

