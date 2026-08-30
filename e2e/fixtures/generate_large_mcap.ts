/**
 * Generates a large MCAP fixture for exercising load progress reporting.
 *
 * The committed fixtures are a few KB and hold 10 rosout messages, so they
 * never cross the 100-record throttle in the progress emitters: phases never
 * advance, the message counter jumps straight to its final value, and the
 * determinate bar never moves. This script builds a file big enough to watch
 * all of that happen for real.
 *
 * Schemas and channel metadata are copied from test_sample.mcap so the
 * generated messages travel the exact reader path the small fixture does.
 *
 * Chunks are written uncompressed on purpose. What this fixture is for is the
 * outer .mcap.zstd wrapper: the app detects it by magic bytes, materializes the
 * whole file, and only then hands it to the indexed reader. Leaving the chunks
 * uncompressed keeps generation fast and makes the materialized size — the
 * number that drives load time — match the plain .mcap on disk.
 *
 * Output is git-ignored; regenerate it whenever you need it.
 *
 * Run with:
 *   npx tsx e2e/fixtures/generate_large_mcap.ts
 *   npx tsx e2e/fixtures/generate_large_mcap.ts --messages 1000000 --keep-plain
 *
 * Options:
 *   --messages N    rosout messages to write (default 500000)
 *   --every N       emit a DiagnosticArray every N rosout messages (default 100)
 *   --out PATH      output path (default e2e/fixtures/test_large.mcap.zstd)
 *   --keep-plain    keep the intermediate uncompressed .mcap as well
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { open } from 'node:fs/promises';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import * as zlib from 'node:zlib';

import { McapIndexedReader, McapWriter } from '@mcap/core';
import type { IReadable, IWritable } from '@mcap/core';
import { decompress as zstdDecompress } from 'fzstd';
import { parse as parseMessageDefinition } from '@foxglove/rosmsg';
import { MessageWriter } from '@foxglove/rosmsg2-serialization';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// -- CLI ---------------------------------------------------------------------

function intArg(flag: string, fallback: number): number {
  const index = process.argv.indexOf(flag);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} expects a positive integer, got: ${process.argv[index + 1]}`);
  }
  return value;
}

function stringArg(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index < 0 ? fallback : process.argv[index + 1] ?? fallback;
}

const MESSAGE_COUNT = intArg('--messages', 500_000);
const DIAGNOSTICS_EVERY = intArg('--every', 100);
const OUTPUT = path.resolve(stringArg('--out', path.join(__dirname, 'test_large.mcap.zstd')));
const KEEP_PLAIN = process.argv.includes('--keep-plain');
const PLAIN_OUTPUT = OUTPUT.replace(/\.zstd$/, '') || `${OUTPUT}.mcap`;

// -- Deterministic pseudo-random data ----------------------------------------

// Seeded so regenerating the fixture reproduces the same file byte for byte.
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(0x5eed);

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

const NODES = [
  '/perception/lidar_driver', '/perception/camera_driver', '/perception/object_detector',
  '/localization/ekf_localizer', '/localization/ndt_matcher', '/planning/behavior_planner',
  '/planning/motion_planner', '/control/trajectory_follower', '/control/vehicle_interface',
  '/system/diagnostic_aggregator', '/system/watchdog', '/sensing/imu_driver',
  '/sensing/gnss_driver', '/map/map_loader', '/map/lanelet2_map_visualizer',
  '/battery/monitor', '/motor/left_driver', '/motor/right_driver',
  '/ui/joystick_bridge', '/ui/status_publisher',
];

// Weighted to look like a real log: mostly INFO, a long tail of problems.
const SEVERITIES = [
  ...Array<number>(6).fill(20), // INFO
  ...Array<number>(2).fill(10), // DEBUG
  ...Array<number>(2).fill(30), // WARN
  40,                           // ERROR
  50,                           // FATAL
];

const TEMPLATES = [
  'published %d points in %dms',
  'received %d frames, dropped %d',
  'transform lookup took %dms (limit %dms)',
  'queue depth %d, latency %dms',
  'callback %d exceeded budget by %dms',
  'reconnect attempt %d of %d',
  'calibration drift %d ppm over %d samples',
  'buffer occupancy %d%% after %d writes',
];

function renderMessage(): string {
  return pick(TEMPLATES).replace(/%d/g, () => String(Math.floor(random() * 1000)));
}

const COMPONENTS = [
  'lidar_front', 'lidar_rear', 'camera_left', 'camera_right', 'imu',
  'gnss', 'motor_left', 'motor_right', 'battery', 'cpu_temperature',
];

// -- MCAP output -------------------------------------------------------------

class FileWritable implements IWritable {
  #position = 0n;
  constructor(private readonly handle: fs.promises.FileHandle) {}

  position(): bigint {
    return this.#position;
  }

  async write(buffer: Uint8Array): Promise<void> {
    await this.handle.write(buffer);
    this.#position += BigInt(buffer.byteLength);
  }
}

class Uint8ArrayReadable implements IReadable {
  constructor(private readonly bytes: Uint8Array) {}
  async size(): Promise<bigint> {
    return BigInt(this.bytes.byteLength);
  }
  async read(offset: bigint, length: bigint): Promise<Uint8Array> {
    return this.bytes.subarray(Number(offset), Number(offset + length));
  }
}

/** Pulls the rosout and diagnostics schema/channel definitions off the small fixture. */
async function readTemplateDefinitions() {
  const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, 'test_sample.mcap')));
  const reader = await McapIndexedReader.Initialize({
    readable: new Uint8ArrayReadable(bytes),
    decompressHandlers: { zstd: (data) => zstdDecompress(new Uint8Array(data)) },
  });

  const find = (schemaName: string) => {
    const schema = [...reader.schemasById.values()].find((s) => s.name === schemaName);
    if (!schema) throw new Error(`test_sample.mcap has no ${schemaName} schema`);
    const channel = [...reader.channelsById.values()].find((c) => c.schemaId === schema.id);
    if (!channel) throw new Error(`test_sample.mcap has no channel for ${schemaName}`);
    return { schema, channel };
  };

  return { rosout: find('rcl_interfaces/msg/Log'), diagnostics: find('diagnostic_msgs/msg/DiagnosticArray') };
}

function messageWriterFor(schemaData: Uint8Array): MessageWriter {
  return new MessageWriter(parseMessageDefinition(new TextDecoder().decode(schemaData), { ros2: true }));
}

const BASE_TIME_NS = 1_700_000_000_000_000_000n;
const INTERVAL_NS = 10_000_000n; // 10ms between rosout messages

async function writePlainMcap(): Promise<void> {
  const { rosout, diagnostics } = await readTemplateDefinitions();
  const rosoutWriter = messageWriterFor(rosout.schema.data);
  const diagnosticsWriter = messageWriterFor(diagnostics.schema.data);

  const handle = await open(PLAIN_OUTPUT, 'w');
  const writer = new McapWriter({
    writable: new FileWritable(handle),
    useChunks: true,
    useStatistics: true,
    useChunkIndex: true,
    useSummaryOffsets: true,
    chunkSize: 4 * 1024 * 1024,
  });

  await writer.start({ profile: 'ros2', library: 'rosbag-analyzer-web fixtures' });

  const rosoutSchemaId = await writer.registerSchema({
    name: rosout.schema.name, encoding: rosout.schema.encoding, data: rosout.schema.data,
  });
  const rosoutChannelId = await writer.registerChannel({
    schemaId: rosoutSchemaId, topic: rosout.channel.topic,
    messageEncoding: rosout.channel.messageEncoding, metadata: rosout.channel.metadata,
  });
  const diagnosticsSchemaId = await writer.registerSchema({
    name: diagnostics.schema.name, encoding: diagnostics.schema.encoding, data: diagnostics.schema.data,
  });
  const diagnosticsChannelId = await writer.registerChannel({
    schemaId: diagnosticsSchemaId, topic: diagnostics.channel.topic,
    messageEncoding: diagnostics.channel.messageEncoding, metadata: diagnostics.channel.metadata,
  });

  // The collector only keeps a diagnostics row when a component's level,
  // message or values change, so component state has to be sticky: hold each
  // component steady and flip one per array. Reported values are derived from
  // that state, otherwise every status would look changed and the dedup path
  // would never run.
  const states = new Map(COMPONENTS.map((name) => [name, { level: 0, epoch: 0 }]));
  let diagnosticsArrays = 0;

  for (let i = 0; i < MESSAGE_COUNT; i++) {
    const logTime = BASE_TIME_NS + BigInt(i) * INTERVAL_NS;
    const sec = Number(logTime / 1_000_000_000n);
    const nanosec = Number(logTime % 1_000_000_000n);

    await writer.addMessage({
      channelId: rosoutChannelId,
      sequence: i,
      logTime,
      publishTime: logTime,
      data: rosoutWriter.writeMessage({
        stamp: { sec, nanosec },
        level: pick(SEVERITIES),
        name: pick(NODES),
        msg: renderMessage(),
        file: `src/${pick(NODES).slice(1).replace(/\//g, '_')}.cpp`,
        function: 'onTimer',
        line: Math.floor(random() * 900) + 20,
      }),
    });

    if (i % 50_000 === 0) {
      process.stdout.write(`\r  ${i.toLocaleString()} / ${MESSAGE_COUNT.toLocaleString()} rosout messages`);
    }

    if (i % DIAGNOSTICS_EVERY !== 0) continue;

    if (random() < 0.5) {
      const component = pick(COMPONENTS);
      const state = states.get(component)!;
      // Pick a level other than the current one so the flip is a real change.
      state.level = (state.level + 1 + Math.floor(random() * 3)) % 4;
      state.epoch++;
    }
    await writer.addMessage({
      channelId: diagnosticsChannelId,
      sequence: diagnosticsArrays++,
      logTime,
      publishTime: logTime,
      data: diagnosticsWriter.writeMessage({
        header: { stamp: { sec, nanosec }, frame_id: '' },
        status: COMPONENTS.map((name) => {
          const { level, epoch } = states.get(name)!;
          return {
            level,
            name: `/${name}`,
            message: ['OK', 'Warning: degraded', 'Error: fault detected', 'Stale: no update'][level],
            hardware_id: name,
            values: [
              { key: 'frequency', value: (20 + ((epoch * 7) % 80)).toFixed(1) },
              { key: 'error_count', value: String(epoch) },
            ],
          };
        }),
      }),
    });
  }

  await writer.end();
  await handle.close();
  process.stdout.write(`\r  ${MESSAGE_COUNT.toLocaleString()} rosout messages, ${diagnosticsArrays.toLocaleString()} diagnostic arrays\n`);
}

// -- zstd wrapper ------------------------------------------------------------

/**
 * Node gained zlib zstd support in 22.15; older 22.x needs the zstd CLI.
 * Both stream, so peak memory stays flat regardless of fixture size.
 */
async function compress(): Promise<void> {
  const createZstdCompress = (zlib as unknown as {
    createZstdCompress?: () => NodeJS.ReadWriteStream;
  }).createZstdCompress;

  if (createZstdCompress) {
    await pipeline(fs.createReadStream(PLAIN_OUTPUT), createZstdCompress(), fs.createWriteStream(OUTPUT));
    return;
  }

  const result = spawnSync('zstd', ['-f', '-T0', '-o', OUTPUT, PLAIN_OUTPUT], { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error(
      'zstd compression needs either Node >= 22.15 (zlib.createZstdCompress) or the zstd CLI on PATH.',
    );
  }
}

function mib(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

console.log(`Writing ${MESSAGE_COUNT.toLocaleString()} rosout messages to ${PLAIN_OUTPUT}`);
await writePlainMcap();
const plainSize = fs.statSync(PLAIN_OUTPUT).size;

console.log('Compressing with zstd...');
await compress();
const compressedSize = fs.statSync(OUTPUT).size;

if (!KEEP_PLAIN) fs.unlinkSync(PLAIN_OUTPUT);

console.log(`\nGenerated: ${OUTPUT}`);
console.log(`  on disk:      ${mib(compressedSize)}`);
console.log(`  materialized: ${mib(plainSize)}  <- what the loader actually parses`);
if (KEEP_PLAIN) console.log(`  kept:         ${PLAIN_OUTPUT}`);
