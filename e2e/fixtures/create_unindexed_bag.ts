/**
 * Creates an unindexed ROS bag file fixture for e2e testing.
 *
 * Run with: npx tsx e2e/fixtures/create_unindexed_bag.ts
 *
 * This creates a valid unindexed bag by taking the existing test_sample.bag
 * and stripping its index section (truncating at index_pos and zeroing the
 * bag header fields).
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.resolve(__dirname, 'test_sample.bag');
const OUTPUT = path.resolve(__dirname, 'test_unindexed.bag');

const data = fs.readFileSync(INPUT);
const buf = Buffer.from(data);

// Verify preamble
const preamble = buf.subarray(0, 13).toString('ascii');
if (preamble !== '#ROSBAG V2.0\n') {
  throw new Error('Not a valid ROS bag file');
}

// Parse bag header record at offset 13
let offset = 13;
const headerLen = buf.readUInt32LE(offset);
offset += 4;

// Parse header fields to find index_pos
let indexPos = 0;
let fieldOffset = offset;
const headerEnd = offset + headerLen;

interface FieldLocation {
  valueOffset: number;
  valueLen: number;
}

const fieldLocations: Record<string, FieldLocation> = {};

while (fieldOffset < headerEnd) {
  const fieldLen = buf.readUInt32LE(fieldOffset);
  fieldOffset += 4;
  const fieldBytes = buf.subarray(fieldOffset, fieldOffset + fieldLen);
  const eqIdx = fieldBytes.indexOf(0x3d); // '='
  if (eqIdx >= 0) {
    const key = fieldBytes.subarray(0, eqIdx).toString('ascii');
    const valueOffset = fieldOffset + eqIdx + 1;
    const valueLen = fieldLen - eqIdx - 1;
    fieldLocations[key] = { valueOffset, valueLen };

    if (key === 'index_pos') {
      indexPos = Number(buf.readBigUInt64LE(valueOffset));
    }
  }
  fieldOffset += fieldLen;
}

console.log(`Original index_pos: ${indexPos}`);
console.log(`Original file size: ${buf.length}`);

if (indexPos === 0) {
  console.log('File is already unindexed!');
  process.exit(1);
}

// Truncate at index_pos (remove index section)
const truncated = Buffer.alloc(indexPos);
buf.copy(truncated, 0, 0, indexPos);

// Zero out bag header fields
const indexPosLoc = fieldLocations['index_pos'];
if (indexPosLoc) {
  truncated.writeBigUInt64LE(0n, indexPosLoc.valueOffset);
}
const connCountLoc = fieldLocations['conn_count'];
if (connCountLoc) {
  truncated.writeUInt32LE(0, connCountLoc.valueOffset);
}
const chunkCountLoc = fieldLocations['chunk_count'];
if (chunkCountLoc) {
  truncated.writeUInt32LE(0, chunkCountLoc.valueOffset);
}

fs.writeFileSync(OUTPUT, truncated);
console.log(`Generated: ${OUTPUT}`);
console.log(`Size: ${truncated.length} bytes (was ${buf.length})`);
console.log('Bag header: index_pos=0, conn_count=0, chunk_count=0 (unindexed)');

// Also create a truncated bag (chunk cut in the middle, simulating crashed recording)
const TRUNCATED_OUTPUT = path.resolve(__dirname, 'test_truncated.bag');
// Cut the unindexed bag at ~60% of the chunk data to simulate a crash
const truncateAt = Math.floor(indexPos * 0.6);
const truncatedBag = Buffer.alloc(truncateAt);
truncated.copy(truncatedBag, 0, 0, truncateAt);
fs.writeFileSync(TRUNCATED_OUTPUT, truncatedBag);
console.log(`\nGenerated: ${TRUNCATED_OUTPUT}`);
console.log(`Size: ${truncatedBag.length} bytes (truncated at ${truncateAt})`);
