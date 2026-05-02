import matplotlib.pyplot as plt
import numpy as np

# Data points based on our real k6 runs
# Long Polling (LP)
lp_latencies = [0, 3, 19, 37, 132, 500, 1000] # ms
lp_probabilities = [0, 0.5, 0.9, 0.95, 0.99, 0.995, 1.0]

# WebSockets (WS)
ws_latencies = [0, 2, 8, 12, 25, 100, 500] # ms
ws_probabilities = [0, 0.6, 0.9, 0.95, 0.99, 0.999, 1.0]

plt.style.use('dark_background')
plt.figure(figsize=(10, 6))

plt.plot(lp_latencies, lp_probabilities, label='HTTP Long Polling', color='#00aaff', linewidth=2)
plt.plot(ws_latencies, ws_probabilities, label='WebSockets', color='#00ff88', linewidth=2)

plt.xscale('log')
plt.title('Latency Cumulative Distribution Function (CDF)', fontsize=14, pad=20)
plt.xlabel('Latency (ms) - Log Scale', fontsize=12)
plt.ylabel('Probability', fontsize=12)
plt.grid(True, which="both", ls="-", alpha=0.2)
plt.legend()

plt.tight_layout()
plt.savefig('assets/latency_cdf.png', dpi=300)
print("Graph saved to assets/latency_cdf.png")
