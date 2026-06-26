import argparse
from PIL import Image
import os
import glob
import re

def natural_sort_key(s):
    return [int(text) if text.isdigit() else text.lower() for text in re.split('([0-9]+)', s)]

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Stitch frames into a GIF.')
    parser.add_argument('frame_dir', type=str, help='Directory containing the frames.')
    parser.add_argument('output_path', type=str, help='Output path for the GIF.')
    args = parser.parse_args()

    frame_dir = args.frame_dir
    output_path = args.output_path

    # Get all frame PNGs and sort them
    frames_paths = glob.glob(os.path.join(frame_dir, "frame_*.png"))
    frames_paths.sort(key=natural_sort_key)

    print(f"Found {len(frames_paths)} frames in {frame_dir}.")

    # Create the GIF
    images = []
    for path in frames_paths:
        img = Image.open(path)
        # Resize for consistent layout if needed, but here we keep original
        images.append(img.convert("RGB"))

    if images:
        # Ensure parent directories exist
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
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
