#!/bin/bash
# Clear all tc rules on loopback interface
tc qdisc del dev lo root
echo "Network rules cleared on lo"
