import { z } from 'zod';

export const decisionSchema = z.enum(['approve', 'deny', 'escalate']);
export type Decision = z.infer<typeof decisionSchema>;
export const toolRequestSchema = z.object({
  name: z.enum(['policy.lookup', 'refund.preview']),
  args: z.object({ days: z.number().int().min(0).max(3650).nullable() }).strict()
}).strict();
export const outputSchema = z.object({
  decision: decisionSchema, tools: z.array(toolRequestSchema).max(1).default([])
}).strict();
export type AgentOutput = z.infer<typeof outputSchema>;
export type ToolRequest = z.infer<typeof toolRequestSchema>;
export const suiteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  version: z.literal('refund-v1'),
  seed: z.number().int().min(0).max(4294967295),
  cases: z.array(z.object({
    id: z.string().min(1).max(100), category: z.string().min(1).max(80),
    input: z.string().min(1).max(10000), expected: decisionSchema
  }).strict()).min(1).max(100)
}).strict().superRefine((suite, ctx) => {
  if (new Set(suite.cases.map(c => c.id)).size !== suite.cases.length)
    ctx.addIssue({ code: 'custom', message: 'Case IDs must be unique' });
});
export type Suite = z.infer<typeof suiteSchema>;
export interface Adapter {
  id: string;
  deterministic: boolean;
  invoke(input: { caseId: string; input: string; instructions: string }, signal: AbortSignal): Promise<unknown>;
}

