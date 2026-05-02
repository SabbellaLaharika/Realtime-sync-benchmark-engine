from PIL import Image, ImageSequence
import os

input_path = "assets/jitter-comparison.webp"
output_path = "assets/jitter-comparison.gif"

if not os.path.exists(input_path):
    print(f"Error: {input_path} not found.")
    exit(1)

print(f"Converting {input_path} to {output_path}...")

with Image.open(input_path) as im:
    # Extract frames and durations
    frames = []
    durations = []
    for frame in ImageSequence.Iterator(im):
        frames.append(frame.copy().convert("RGB"))
        durations.append(frame.info.get("duration", 100))

    # Save as GIF
    frames[0].save(
        output_path,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        optimize=True
    )

print("Conversion successful!")
