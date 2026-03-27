#!/usr/bin/env python3
"""Generate a small MCAP file for E2E testing.

Usage (Docker):
  docker build -t mcap-gen -f e2e/fixtures/Dockerfile.mcap e2e/fixtures
  docker run --rm -v "$(pwd)/e2e/fixtures:/work" mcap-gen
"""

from mcap_ros2.writer import Writer as McapRos2Writer
from builtin_interfaces.msg import Time
from rcl_interfaces.msg import Log
from diagnostic_msgs.msg import DiagnosticArray, DiagnosticStatus, KeyValue

OUTPUT = "test_sample.mcap"
BASE_SEC = 1700000000  # 2023-11-14T22:13:20Z

# ROS2 message definitions (ros2msg encoding)
LOG_MSGDEF = """\
builtin_interfaces/Time stamp
uint8 level
string name
string msg
string file
string function
uint32 line

================================================================================
MSG: builtin_interfaces/Time
int32 sec
uint32 nanosec
"""

DIAGNOSTIC_ARRAY_MSGDEF = """\
std_msgs/Header header
diagnostic_msgs/DiagnosticStatus[] status

================================================================================
MSG: std_msgs/Header
builtin_interfaces/Time stamp
string frame_id

================================================================================
MSG: builtin_interfaces/Time
int32 sec
uint32 nanosec

================================================================================
MSG: diagnostic_msgs/DiagnosticStatus
uint8 level
string name
string message
string hardware_id
diagnostic_msgs/KeyValue[] values

================================================================================
MSG: diagnostic_msgs/KeyValue
string key
string value
"""

# Same data as generate_test_bag.py for consistency
rosout_data = [
    # (offset_sec, node, severity, message)
    (0.0, "/sensor/lidar", Log.DEBUG, "Lidar driver initialized"),
    (0.1, "/sensor/lidar", Log.INFO, "Scan rate: 10Hz"),
    (0.2, "/sensor/camera", Log.INFO, "Camera connected"),
    (0.5, "/sensor/camera", Log.WARN, "Low frame rate detected"),
    (1.0, "/planner/global", Log.INFO, "Path planning started"),
    (1.5, "/planner/global", Log.ERROR, "Failed to find valid path"),
    (2.0, "/motor/controller", Log.INFO, "Motor driver ready"),
    (2.5, "/motor/controller", Log.WARN, "High current draw on left motor"),
    (3.0, "/sensor/lidar", Log.ERROR, "Connection timeout"),
    (3.5, "/system/monitor", Log.FATAL, "System watchdog timeout"),
]

diag_data = [
    # (offset_sec, [(name, level, message, {key: value})])
    (0.0, [
        ("/sensor/lidar", DiagnosticStatus.OK, "Running normally",
         {"frequency": "10.0", "packets_received": "1000"}),
        ("/sensor/camera", DiagnosticStatus.OK, "Connected",
         {"fps": "30", "resolution": "1920x1080"}),
    ]),
    (1.0, [
        ("/sensor/lidar", DiagnosticStatus.OK, "Running normally",
         {"frequency": "10.0", "packets_received": "2000"}),
        ("/sensor/camera", DiagnosticStatus.WARN, "Low frame rate",
         {"fps": "12", "resolution": "1920x1080"}),
    ]),
    (2.0, [
        ("/sensor/lidar", DiagnosticStatus.ERROR, "Connection lost",
         {"frequency": "0.0", "error_count": "5"}),
        ("/sensor/camera", DiagnosticStatus.OK, "Recovered",
         {"fps": "28", "resolution": "1920x1080"}),
    ]),
    (3.0, [
        ("/sensor/lidar", DiagnosticStatus.STALE, "No data received",
         {"last_update": "2.5s ago"}),
        ("/motor/left", DiagnosticStatus.WARN, "High temperature",
         {"temp_celsius": "75.2", "current_amps": "4.8"}),
    ]),
]


def make_time(offset: float) -> Time:
    sec = BASE_SEC + int(offset)
    nanosec = int((offset % 1) * 1e9)
    return Time(sec=sec, nanosec=nanosec)


def log_time_ns(offset: float) -> int:
    return int((BASE_SEC + offset) * 1e9)


with open(OUTPUT, "wb") as f:
    writer = McapRos2Writer(f)

    log_schema = writer.register_msgdef("rcl_interfaces/msg/Log", LOG_MSGDEF)
    diag_schema = writer.register_msgdef(
        "diagnostic_msgs/msg/DiagnosticArray", DIAGNOSTIC_ARRAY_MSGDEF
    )

    # Write rosout messages
    for offset, node, severity, message in rosout_data:
        msg = Log()
        msg.stamp = make_time(offset)
        msg.level = severity
        msg.name = node
        msg.msg = message
        msg.file = "test_node.cpp"
        msg.function = "main"
        msg.line = 42
        writer.write_message(
            topic="/rosout",
            schema=log_schema,
            message=msg,
            log_time=log_time_ns(offset),
            publish_time=log_time_ns(offset),
        )

    # Write diagnostics messages
    for offset, statuses in diag_data:
        arr = DiagnosticArray()
        arr.header.stamp = make_time(offset)
        for name, level, message, values in statuses:
            s = DiagnosticStatus()
            s.name = name
            # level is 'byte' in ROS2 but msgdef uses uint8; ensure int
            s.level = int.from_bytes(level, "little") if isinstance(level, bytes) else int(level)
            s.message = message
            s.values = [KeyValue(key=k, value=v) for k, v in values.items()]
            arr.status.append(s)
        writer.write_message(
            topic="/diagnostics_agg",
            schema=diag_schema,
            message=arr,
            log_time=log_time_ns(offset),
            publish_time=log_time_ns(offset),
        )

    writer.finish()

# Verify
from mcap.reader import make_reader

with open(OUTPUT, "rb") as f:
    reader = make_reader(f)
    summary = reader.get_summary()
    print(f"Generated: {OUTPUT}")
    if summary and summary.statistics:
        print(f"Total messages: {summary.statistics.message_count}")
        for channel_id, count in summary.statistics.channel_message_counts.items():
            channel = summary.channels[channel_id]
            schema = summary.schemas[channel.schema_id]
            print(f"  {channel.topic}: {count} msgs ({schema.name})")

# Generate zstd-compressed variant
import subprocess
ZSTD_OUTPUT = "test_sample.mcap.zstd"
subprocess.run(["zstd", "-f", OUTPUT, "-o", ZSTD_OUTPUT], check=True)
print(f"Generated: {ZSTD_OUTPUT}")

# Generate truncated variant (cut at ~half for testing error handling)
TRUNCATED_OUTPUT = "test_sample_truncated.mcap"
with open(OUTPUT, "rb") as f:
    data = f.read()
with open(TRUNCATED_OUTPUT, "wb") as f:
    f.write(data[: len(data) // 2])
print(f"Generated: {TRUNCATED_OUTPUT} ({len(data) // 2} bytes, truncated from {len(data)})")
