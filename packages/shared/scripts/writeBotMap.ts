// `npm run bot-map`: rebuilds the Python bots' map of the world (src/sim/botMap.ts).
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { buildBotMap } from '../src/sim/botMap';

const out = new URL('../../../modal-bots/common/world_map.json.gz', import.meta.url);
const map = buildBotMap();
writeFileSync(out, gzipSync(JSON.stringify(map), { level: 9 }));
console.log(
  `wrote ${map.nodes.length} nodes, ${map.edges.flat().length} walks and ${map.jumps.flat().length} jumps to ${out.pathname}`,
);
