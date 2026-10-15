"""Encode the hero-to-tour transition (Goblet_Scroll_Hero_Animation.mp4) for the front page.

    python3 tools/encode_goblet_transition.py "Goblet_Scroll_Hero_Animation.mp4"

The render is 1920x3072, 121 frames at 60 fps, upright (the tour's first frame) at frame 0 and lying on
its side (the hero) at frame 120; the site plays it backwards. Frames are cropped to the box the engine
sweeps through, scaled down, and written as one pack of AVIF frames (assets/goblet/turn.json, same format as
the tour packs). It also registers both ends by silhouette: frame 120 against the hero still and frame 0
against the tour's first frame, and prints the "turn" block for gx-config: for each end, the scale and
offset that place a pack frame exactly over that image (hero: in the hero still's pixels; tour: in the tour
frames' 864x1080 pixels).

Needs ffmpeg, Pillow, numpy and scipy. TOUR_VIDEO is the scroll render (for its first frame).
"""
import base64, io, json, os, subprocess, sys, tempfile
import numpy as np
from PIL import Image

VIDEO = sys.argv[1]
TOUR_VIDEO = sys.argv[2] if len(sys.argv) > 2 else None
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
K = 0.5          # pack frames at half the render's size (about 2x the size they show at)
Q = 44

tmp = tempfile.mkdtemp()
subprocess.run(["ffmpeg", "-v", "error", "-i", VIDEO, "-vsync", "0", "-start_number", "0", f"{tmp}/f_%03d.png"], check=True)
names = sorted(f for f in os.listdir(tmp) if f.startswith("f_"))
frames = [np.asarray(Image.open(os.path.join(tmp, f)).convert("RGB")) for f in names]
n = len(frames)


def mask(a, thr=14):
    return a.max(2) > thr


# the box the engine sweeps through, with a small margin
union = np.zeros(frames[0].shape[:2], bool)
for a in frames: union |= mask(a)
ys, xs = np.nonzero(union)
x0, y0, x1, y1 = max(xs.min() - 8, 0), max(ys.min() - 8, 0), min(xs.max() + 9, union.shape[1]), min(ys.max() + 9, union.shape[0])
W, H = round((x1 - x0) * K), round((y1 - y0) * K)


def register(src, dst, s_lo, s_hi, steps):
    """scale s and offset o so that dst ~ src scaled by s and moved by o (silhouette overlap, IoU)"""
    yd, xd = np.nonzero(dst); dcx, dcy = xd.mean(), yd.mean()
    Hd, Wd = dst.shape; best = None
    for s in np.linspace(s_lo, s_hi, steps):
        sw, sh = max(1, round(src.shape[1] * s)), max(1, round(src.shape[0] * s))
        m = np.asarray(Image.fromarray(src.astype(np.uint8) * 255).resize((sw, sh), Image.BILINEAR)) > 127
        ym, xm = np.nonzero(m); cx, cy = xm.mean(), ym.mean()
        for ddx in range(-4, 5):
            for ddy in range(-4, 5):
                ox, oy = round(dcx - cx) + ddx, round(dcy - cy) + ddy
                c = np.zeros_like(dst)
                a0, b0, a1, b1 = max(ox, 0), max(oy, 0), min(ox + sw, Wd), min(oy + sh, Hd)
                if a1 <= a0 or b1 <= b0: continue
                c[b0:b1, a0:a1] = m[b0 - oy:b1 - oy, a0 - ox:a1 - ox]
                iou = (c & dst).sum() / max(1, (c | dst).sum())
                if best is None or iou > best[0]: best = (iou, s, ox, oy)
    return best


def two_pass(src, dst, lo, hi):
    r = 4
    sm = lambda m: np.asarray(Image.fromarray(m.astype(np.uint8) * 255).resize((m.shape[1] // r, m.shape[0] // r))) > 127
    c = register(sm(src), sm(dst), lo, hi, 50)
    return register(src, dst, c[1] - 0.006, c[1] + 0.006, 13)


def to_pack(fit):
    """video px -> target px is s*v + o; pack px u = (v - crop)*K, so target = (s/K)*u + (s*crop + o)"""
    iou, s, ox, oy = fit
    return [round(s / K, 6), round(s * x0 + ox, 2), round(s * y0 + oy, 2), round(float(iou), 3)]


hero = np.asarray(Image.open(os.path.join(ROOT, "assets/hero/goblet-hero-side.webp")).convert("RGBA"))[..., 3] > 128
hero_fit = two_pass(mask(frames[-1]), hero, 1.1, 1.45)
turn = dict(src="assets/goblet/turn.json", w=W, h=H, n=n, hero=to_pack(hero_fit))
if TOUR_VIDEO:
    t = tempfile.mkdtemp()
    subprocess.run(["ffmpeg", "-v", "error", "-i", TOUR_VIDEO, "-frames:v", "1", f"{t}/t.png"], check=True)
    tour = np.asarray(Image.open(f"{t}/t.png").convert("RGB").crop((0, 286, 1080, 1634)).resize((864, 1080), Image.LANCZOS))
    turn["tour"] = to_pack(two_pass(mask(frames[0]), mask(tour), 0.40, 0.50))

out = []
for a in frames:
    im = Image.fromarray(a[y0:y1, x0:x1]).resize((W, H), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, "AVIF", quality=Q, speed=5)
    out.append(base64.b64encode(b.getvalue()).decode())
with open(os.path.join(ROOT, "assets/goblet/turn.json"), "w") as f:
    json.dump(dict(first=0, step=1, type="image/avif", frames=out), f, separators=(",", ":"))
print(json.dumps(turn))
