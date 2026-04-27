#!/bin/bash
# Apply 100ms delay and 2% packet loss to loopback interface
sudo tc qdisc add dev lo root netem delay 100ms 20ms distribution normal loss 2%
echo "Network degradation applied: 100ms delay, 2% loss on lo"
