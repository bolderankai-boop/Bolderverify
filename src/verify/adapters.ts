import { z } from 'zod';
import type { Adapter } from './contracts';

const evidence = z.object({
  days: z.number().int().min(0).max(3650).nullable(),
  conflicting: z.boolean().default(false), note: z.string().max(10000).default('')
}).strict();

export function baseline(id: string): Adapter {
  if (!['policy-v1', 'always-approve-v1', 'always-escalate-v1'].includes(id))
    throw new Error('Unknown baseline');
  return {
    id, deterministic: true,
    async invoke({ input }) {
      if (id === 'always-approve-v1') return { decision: 'approve' };
      if (id === 'always-escalate-v1') return { decision: 'escalate' };
      const parsed = evidence.safeParse(JSON.parse(input));
      if (!parsed.success) return { decision: 'escalate' };
      const { days, conflicting } = parsed.data;
      return { decision: conflicting || days === null ? 'escalate' : days <= 30 ? 'approve' : 'deny' };
    }
  };
}

export interface RemoteConfig { endpoint: string; token?: string; revision: string }
// Server-configured adapter only. No browser-supplied URLs or provider credentials.
export function httpAdapter(config: RemoteConfig, fetcher: typeof fetch = fetch): Adapter {
  const url = new URL(config.endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new Error('Model endpoint must be credential-free HTTPS');
  return {
    id: `http:${config.revision}`, deterministic: false,
    async invoke(input, signal) {
      const response = await fetcher(url, {
        method: 'POST', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json', ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}) },
        body: JSON.stringify(input)
      });
      if (!response.ok) throw new Error('Model endpoint failed');
      // Bound response memory even when Content-Length is absent or incorrect.
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Model response missing');
      const chunks: Uint8Array[] = []; let length = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 65536) throw new Error('Model response too large');
          chunks.push(value);
        }
      } finally { await reader.cancel(); }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return JSON.parse(new TextDecoder().decode(bytes));
    }
  };
}

