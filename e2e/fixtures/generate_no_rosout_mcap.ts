/**
 * Generates an MCAP fixture with only an unrelated topic (no rosout, no
 * diagnostics) for e2e testing the "loaded but no relevant messages" UI.
 *
 * Run with: npx tsx e2e/fixtures/generate_no_rosout_mcap.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { McapWriter, TempBuffer } from '@mcap/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.resolve(__dirname, 'test_sample_no_rosout.mcap');

const buf = new TempBuffer();
const writer = new McapWriter({ writable: buf });
await writer.start({ profile: 'ros2', library: 'rosbag-analyzer-web fixtures' });

const schemaId = await writer.registerSchema({
  name: 'sensor_msgs/msg/PointCloud2',
  encoding: 'ros2msg',
  data: new TextEncoder().encode('# placeholder schema for fixture'),
});

const channelId = await writer.registerChannel({
  schemaId,
  topic: '/sensor/lidar/points',
  messageEncoding: 'cdr',
  metadata: new Map(),
});

for (let i = 0; i < 3; i++) {
  await writer.addMessage({
    channelId,
    sequence: i,
    logTime: BigInt(1_700_000_000_000_000_000n + BigInt(i) * 100_000_000n),
    publishTime: BigInt(1_700_000_000_000_000_000n + BigInt(i) * 100_000_000n),
    data: new Uint8Array([0, 0, 0, 0]),
  });
}

await writer.end();
fs.writeFileSync(OUTPUT, buf.get());
console.log(`Generated: ${OUTPUT} (${buf.get().byteLength} bytes)`);
