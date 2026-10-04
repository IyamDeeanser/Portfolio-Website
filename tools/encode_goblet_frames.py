"""Turn the Goblet scroll render into the frame packs the front page uses.

    python3 tools/encode_goblet_frames.py "Goblet Scroll Animation.mp4"

Needs ffmpeg and Pillow. Writes assets/goblet/{d-*.json, m-*.json, poster.webp}.
The packs are JSON files of base64 WebP frames, so the whole sequence is a handful of requests.
"""
import base64, io, json, os, subprocess, sys, tempfile
from PIL import Image
import numpy as np

VIDEO = sys.argv[1]
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "goblet")
CROP = (500, 0, 1420, 1080)        # the engine's column in the 1920x1080 render
COUNT = 265                        # frames used (0 .. 264)
BG = np.array([10, 11, 13], float) # page colour: pure black is lifted to this
PER_DESKTOP, PER_PHONE = 45, 67

tmp = tempfile.mkdtemp()
subprocess.run(["ffmpeg", "-v", "error", "-i", VIDEO, "-vsync", "0", "-start_number", "0", f"{tmp}/f_%03d.png"], check=True)

def frame(i, size=None, q=80):
    im = Image.open(f"{tmp}/f_{i:03d}.png").convert("RGB").crop(CROP)
    a = np.asarray(im).astype(float)
    im = Image.fromarray(np.clip(a + BG * (1 - a / 255.0) + 0.5, 0, 255).astype(np.uint8))
    if size: im = im.resize(size, Image.LANCZOS)
    b = io.BytesIO(); im.save(b, "WEBP", quality=q, method=5)
    return im, b.getvalue()

def pack(kind, idxs, per, size=None, q=80):
    packs = []
    for p in range(0, len(idxs), per):
        chunk = idxs[p:p + per]
        frames = [base64.b64encode(frame(i, size, q)[1]).decode() for i in chunk]
        name = f"{kind}-{len(packs)}.json"
        with open(os.path.join(OUT, name), "w") as f:
            json.dump(dict(first=chunk[0], step=(chunk[1] - chunk[0]) if len(chunk) > 1 else 1, frames=frames), f, separators=(",", ":"))
        packs.append(dict(src=f"assets/goblet/{name}", first=chunk[0], n=len(chunk)))
    return packs

os.makedirs(OUT, exist_ok=True)
d = pack("d", list(range(COUNT)), PER_DESKTOP)
m = pack("m", list(range(0, COUNT, 2)), PER_PHONE, (552, 648), 74)
frame(0)[0].save(os.path.join(OUT, "poster.webp"), quality=82, method=6)
print(json.dumps(dict(d=d, m=m)))   # if the pack layout changed, paste these into "frames" in the gx-config JSON
