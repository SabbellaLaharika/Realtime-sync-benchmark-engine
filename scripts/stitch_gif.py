from PIL import Image
import os
import glob
import re

# Path to the frames
frame_dir = r"C:\Users\RAGHAVA\.gemini\antigravity\brain\9cbee7aa-5b54-45ac-b34b-9fabcb0f414c"
output_path = r"d:\GPP\task20\Realtime-sync-benchmark-engine\assets\jitter-comparison.gif"

def natural_sort_key(s):
    return [int(text) if text.isdigit() else text.lower() for text in re.split('([0-9]+)', s)]

# Get all frame PNGs and sort them
frames_paths = glob.glob(os.path.join(frame_dir, "frame_*.png"))
frames_paths.sort(key=natural_sort_key)

print(f"Found {len(frames_paths)} frames.")

# Create the GIF
images = []
for path in frames_paths:
    img = Image.open(path)
    # Resize for consistent layout if needed, but here we keep original
    images.append(img.convert("RGB"))

if images:
    images[0].save(
        output_path,
        save_all=True,
        append_images=images[1:],
        duration=500,  # 500ms per frame
        loop=0,
        optimize=True
    )
    print(f"GIF successfully created at {output_path}")
else:
    print("No frames found to create GIF.")
