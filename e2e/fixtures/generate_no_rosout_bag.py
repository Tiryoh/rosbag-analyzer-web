#!/usr/bin/env python3
"""Generate a ROS1 bag fixture with only an unrelated topic (no rosout, no
diagnostics) for the "loaded but no relevant messages" e2e test.

Usage (Docker):
  docker run --rm -v "$(pwd)/e2e/fixtures:/work" \
    ros:noetic-ros-base \
    bash -c "source /opt/ros/noetic/setup.bash && cd /work && python3 generate_no_rosout_bag.py"
"""

import rospy
import rosbag
from sensor_msgs.msg import LaserScan

OUTPUT = "test_sample_no_rosout.bag"
BASE_TIME = rospy.Time.from_sec(1700000000.0)

bag = rosbag.Bag(OUTPUT, "w")
try:
    for i in range(3):
        t = BASE_TIME + rospy.Duration(i * 0.1)
        scan = LaserScan()
        scan.header.stamp = t
        scan.header.frame_id = "lidar"
        scan.angle_min = -1.57
        scan.angle_max = 1.57
        scan.angle_increment = 0.01
        scan.range_min = 0.1
        scan.range_max = 30.0
        scan.ranges = [1.0, 2.0, 3.0]
        bag.write("/sensor/lidar/scan", scan, t)
finally:
    bag.close()

print(f"Generated: {OUTPUT}")
