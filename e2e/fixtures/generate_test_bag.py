#!/usr/bin/env python3
"""Generate a small rosbag file for E2E testing.

Usage (Docker):
  docker run --rm -v "$(pwd)/e2e/fixtures:/work" \
    ros:noetic-ros-base \
    bash -c "source /opt/ros/noetic/setup.bash && cd /work && python3 generate_test_bag.py"
"""

import rospy
import rosbag
from rosgraph_msgs.msg import Log
from diagnostic_msgs.msg import DiagnosticArray, DiagnosticStatus, KeyValue

OUTPUT = "test_sample.bag"
BASE_TIME = rospy.Time.from_sec(1700000000.0)  # 2023-11-14T22:13:20Z

bag = rosbag.Bag(OUTPUT, "w")

try:
    # === /rosout_agg messages (rosgraph_msgs/Log) ===
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

    # === /diagnostics_agg messages (diagnostic_msgs/DiagnosticArray) ===
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

# Verify
info_bag = rosbag.Bag(OUTPUT, "r")
print(f"Generated: {OUTPUT}")
print(f"Size: {info_bag.size} bytes")
topics = info_bag.get_type_and_topic_info().topics
for topic, info in topics.items():
    print(f"  {topic}: {info.message_count} msgs ({info.msg_type})")
print(f"Total messages: {info_bag.get_message_count()}")
info_bag.close()
