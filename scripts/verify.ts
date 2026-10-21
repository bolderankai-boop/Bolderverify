import { writeFile } from 'node:fs/promises';
import { generateSuite } from '../src/verify/synthetic';
import { baseline } from '../src/verify/adapters';
import { evaluate } from '../src/verify/engine';
const seed = Number(process.argv[2] ?? 42);
const adapter = baseline(process.argv[3] ?? 'policy-v1');
const report = await evaluate(generateSuite({ seed }), adapter);
await writeFile('results.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report.manifest, outcomeHash: report.outcomeHash, accuracy: report.metrics.accuracy }, null, 2));

