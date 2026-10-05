"""Turn the Goblet scroll render into the frame packs the front page uses.

    python3 tools/encode_goblet_frames.py "Goblet_Scroll_Animation_60fps_For_Website.mp4"

Needs ffmpeg, Pillow and numpy. Writes assets/goblet/{d-*.json, m-*.json, w-*.json, poster.webp} and prints the
"frames" block for the gx-config JSON in index.html (paste it there if the pack layout changed).

The render is 1080x1920 at 60 fps with the scene in a 1080x1348 band (rows 286..1634); pure black around
it is lifted to the page colour. Three sets:
  d-*.json  desktop, every frame, 864x1080 AVIF
  m-*.json  phones, every 2nd frame, 518x648 AVIF
  w-*.json  fallback for browsers without AVIF, every 2nd frame, 518x648 WebP
AVIF is used because it is well under half the size of WebP at the same look and decodes about as fast.

Packs are JSON files of base64 image frames ({first, step, type, frames}). They are written coarse-to-fine:
every 8th frame first, then the frames halfway between, and so on, so the whole tour works after the
first couple of packs and sharpens to full frame rate as the rest arrive. Hosts gzip the JSON, which
takes back the base64 overhead in transfer.
"""
import base64, io, json, os, subprocess, sys, tempfile
from PIL import Image
import numpy as np

VIDEO = sys.argv[1]
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "goblet")
CROP = (0, 286, 1080, 1634)          # the render band inside the 1080x1920 frame
BG = np.array([10, 11, 13], float)   # page colour: pure black is lifted to this
DESKTOP = dict(size=(864, 1080), fmt="AVIF", q=40, every=1, per=64)
PHONE = dict(size=(518, 648), fmt="AVIF", q=42, every=2, per=84)
FALLBACK = dict(size=(518, 648), fmt="WEBP", q=72, every=2, per=60)

tmp = tempfile.mkdtemp()
subprocess.run(["ffmpeg", "-v", "error", "-i", VIDEO, "-vsync", "0", "-start_number", "0", f"{tmp}/f_%04d.png"], check=True)
COUNT = len([f for f in os.listdir(tmp) if f.startswith("f_")])


def frame(i, size, q, fmt="WEBP"):
    im = Image.open(f"{tmp}/f_{i:04d}.png").convert("RGB").crop(CROP)
    a = np.asarray(im).astype(float)
    im = Image.fromarray(np.clip(a + BG * (1 - a / 255.0) + 0.5, 0, 255).astype(np.uint8))
    im = im.resize(size, Image.LANCZOS)
    b = io.BytesIO()
    if fmt == "AVIF": im.save(b, "AVIF", quality=q, speed=5)
    else: im.save(b, "WEBP", quality=q, method=5)
    return im, b.getvalue()


def levels(idxs):
    """Split frame indices into arithmetic runs, coarse first: step 8, then 4, 2, 1 (in units of `every`)."""
    n, out, taken = len(idxs), [], set()
    for step in (8, 4, 2, 1):
        run = [k for k in range(0, n, step) if k not in taken]
        taken.update(run)
        if run: out.append(run)
    if (n - 1) not in taken: out.append([n - 1])
    return out


def runs(seq, per):
    """Cut a sequence into chunks of at most `per` that are each evenly spaced (packs store first + step)."""
    out, cur = [], []
    for v in seq:
        if len(cur) >= per or (len(cur) >= 2 and v - cur[-1] != cur[1] - cur[0]):
            out.append(cur); cur = []
        cur.append(v)
    if cur: out.append(cur)
    return out


def pack(kind, cfg):
    idxs = list(range(0, COUNT, cfg["every"]))
    if idxs[-1] != COUNT - 1: idxs.append(COUNT - 1)   # always include the last frame (the final stop)
    packs = []
    for run in levels(idxs):
        for chunk in runs([idxs[k] for k in run], cfg["per"]):
            step = chunk[1] - chunk[0] if len(chunk) > 1 else 1
            frames = [base64.b64encode(frame(i, cfg["size"], cfg["q"], cfg["fmt"])[1]).decode() for i in chunk]
            name = f"{kind}-{len(packs)}.json"
            with open(os.path.join(OUT, name), "w") as f:
                json.dump(dict(first=chunk[0], step=step, type="image/" + cfg["fmt"].lower(), frames=frames), f, separators=(",", ":"))
            packs.append(dict(src=f"assets/goblet/{name}", first=chunk[0], n=len(chunk)))
    return packs


os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if f.endswith(".json") and f[:2] in ("d-", "m-", "w-"): os.remove(os.path.join(OUT, f))
d = pack("d", DESKTOP)
m = pack("m", PHONE)
w = pack("w", FALLBACK)
frame(0, DESKTOP["size"], 82)[0].save(os.path.join(OUT, "poster.webp"), quality=82, method=6)
W, H = DESKTOP["size"]
print(json.dumps(dict(w=W, h=H, count=COUNT, fadeTop=0.3, fadeBottom=0.06, d=d, m=m, fb=w)))
