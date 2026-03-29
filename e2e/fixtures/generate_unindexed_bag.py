#!/usr/bin/env python3
"""Generate a small unindexed rosbag file for E2E testing.

An unindexed bag has indexPosition=0, connectionCount=0, chunkCount=0
in its bag header. This simulates a bag that was not properly closed
(e.g. recording was interrupted).

Usage (Docker):
  docker run --rm -v "$(pwd)/e2e/fixtures:/work" \
    ros:noetic-ros-base \
    bash -c "source /opt/ros/noetic/setup.bash && cd /work && python3 generate_unindexed_bag.py"
"""

import struct
import rospy
import rosbag
from rosgraph_msgs.msg import Log
from diagnostic_msgs.msg import DiagnosticArray, DiagnosticStatus, KeyValue

# First, create a normal indexed bag
TEMP_OUTPUT = "test_sample_indexed_temp.bag"
OUTPUT = "test_unindexed.bag"
BASE_TIME = rospy.Time.from_sec(1700000000.0)  # 2023-11-14T22:13:20Z

bag = rosbag.Bag(TEMP_OUTPUT, "w")

try:
    # === /rosout_agg messages (rosgraph_msgs/Log) ===
    rosout_data = [
        (0.0, "/sensor/lidar", Log.DEBUG, "Lidar driver initialized"),
        (0.1, "/sensor/lidar", Log.INFO, "Scan rate: 10Hz"),
        (0.2, "/sensor/camera", Log.INFO, "Camera connected"),
        (0.5, "/sensor/camera", Log.WARN, "Low frame rate detected"),
        (1.0, "/planner/global", Log.INFO, "Path planning started"),
    ]

    for offset, node, severity, message in rosout_data:
        msg = Log()
        msg.header.stamp = BASE_TIME + rospy.Duration.from_sec(offset)
        msg.level = severity
        msg.name = node
        msg.msg = message
        msg.file = "test_node.cpp"
        msg.function = "main"
        msg.line = 42
        msg.topics = ["/test_topic"]
        t = BASE_TIME + rospy.Duration.from_sec(offset)
        bag.write("/rosout_agg", msg, t)

    # === /diagnostics_agg messages ===
    diag_data = [
        (0.0, [
            ("/sensor/lidar", DiagnosticStatus.OK, "Running normally",
             {"frequency": "10.0"}),
        ]),
        (1.0, [
            ("/sensor/lidar", DiagnosticStatus.WARN, "Low frequency",
             {"frequency": "5.0"}),
        ]),
    ]

    for offset, statuses in diag_data:
        arr = DiagnosticArray()
        arr.header.stamp = BASE_TIME + rospy.Duration.from_sec(offset)
        for name, level, message, values in statuses:
            s = DiagnosticStatus()
            s.name = name
            s.level = level
            s.message = message
            s.values = [KeyValue(key=k, value=v) for k, v in values.items()]
            arr.status.append(s)
        t = BASE_TIME + rospy.Duration.from_sec(offset)
        bag.write("/diagnostics_agg", arr, t)

finally:
    bag.close()

# Now read the indexed bag and strip the index to make it unindexed
with open(TEMP_OUTPUT, "rb") as f:
    data = bytearray(f.read())

# The bag header starts at offset 13 (after "#ROSBAG V2.0\n")
# Parse the bag header record to find the index position
offset = 13
header_len = struct.unpack_from("<I", data, offset)[0]
offset += 4

# Parse header fields to find index_pos
field_offset = offset
while field_offset < offset + header_len:
    field_len = struct.unpack_from("<I", data, field_offset)[0]
    field_offset += 4
    field_bytes = data[field_offset:field_offset + field_len]
    eq_idx = field_bytes.index(b"=")
    key = field_bytes[:eq_idx].decode("ascii")
    if key == "index_pos":
        # Zero out the index_pos field (8 bytes after '=')
        value_offset = field_offset + eq_idx + 1
        struct.pack_into("<Q", data, value_offset, 0)
    elif key == "conn_count":
        value_offset = field_offset + eq_idx + 1
        struct.pack_into("<I", data, value_offset, 0)
    elif key == "chunk_count":
        value_offset = field_offset + eq_idx + 1
        struct.pack_into("<I", data, value_offset, 0)
    field_offset += field_len

# Find where the index section starts by parsing the original bag
orig_bag = rosbag.Bag(TEMP_OUTPUT, "r")
# The index position from the original header
import_offset = 13
hlen = struct.unpack_from("<I", data, import_offset)[0]
import_offset += 4
fo = import_offset
while fo < import_offset + hlen:
    fl = struct.unpack_from("<I", data, fo)[0]
    fo += 4
    fb = bytes(data[fo:fo + fl])
    eq = fb.index(b"=")
    k = fb[:eq].decode("ascii")
    if k == "index_pos":
        # Read original value before we zeroed it
        pass
    fo += fl

# Get index position from the original bag object
index_pos = orig_bag._index_data_pos if hasattr(orig_bag, '_index_data_pos') else None
orig_bag.close()

# Alternative: just truncate everything after the chunks.
# Re-read the temp file to get the original index_pos
with open(TEMP_OUTPUT, "rb") as f:
    orig_data = f.read()

orig_offset = 13
orig_hlen = struct.unpack_from("<I", orig_data, orig_offset)[0]
orig_offset += 4
fo2 = orig_offset
orig_index_pos = None
while fo2 < orig_offset + orig_hlen:
    fl2 = struct.unpack_from("<I", orig_data, fo2)[0]
    fo2 += 4
    fb2 = orig_data[fo2:fo2 + fl2]
    eq2 = fb2.index(b"=")
    k2 = fb2[:eq2].decode("ascii")
    if k2 == "index_pos":
        orig_index_pos = struct.unpack_from("<Q", fb2, eq2 + 1)[0]
    fo2 += fl2

if orig_index_pos and orig_index_pos > 0:
    # Truncate at the index position (remove all index data)
    data = data[:orig_index_pos]

# Write the unindexed bag
with open(OUTPUT, "wb") as f:
    f.write(data)

# Clean up temp file
import os
os.remove(TEMP_OUTPUT)

# Verify
print(f"Generated: {OUTPUT}")
print(f"Size: {len(data)} bytes")
print("Bag header: index_pos=0, conn_count=0, chunk_count=0 (unindexed)")

# Try to open to verify it's actually unindexed
try:
    verify_bag = rosbag.Bag(OUTPUT, "r")
    print(f"WARNING: Bag opened normally with {verify_bag.get_message_count()} messages")
    verify_bag.close()
except Exception as e:
    print(f"Expected: Cannot read normally (unindexed): {e}")
