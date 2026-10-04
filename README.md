# timothycai.com

An online record of my projects and experiences. A static site served by GitHub Pages; no build step.

## Branches

- `master`: the site that is live at timothycai.com.
- `redesign`: the hardware redesign. Pushing here does not change the live site.

To go live, open a pull request from `redesign` into `master` and merge it. Pages republishes in a minute or two.
To roll back, revert that merge.

## Preview locally

    python3 -m http.server 8000

Then open http://localhost:8000. All old URLs still work: `projectpages/*.html` and every file under `assets/img/`, including the résumé and the report PDFs.

## What's where

- `index.html`, `projectpages/*.html`: the pages. The text is the same as the current site.
- `assets/hero/goblet-hero-side.webp`: your Goblet render, shadow removed and turned on its side for the hero. `goblet-vertical.webp`: the CAD cutaway (fallback for the Goblet tour).
- `assets/js/plume.js`: the exhaust plume. A WebGL shader anchored to the nozzle exit; it ignites on load, throttles down as you scroll away, and stops drawing once it is off screen. It animates for everyone, including visitors whose system asks for reduced motion; browsers without WebGL get a soft CSS glow.
- `assets/js/site.js`: scroll reveals, the experience rail, the Goblet walkthrough, the photo viewer.
- `assets/css/site.css`: all styles. Geist and Geist Mono are self-hosted in `assets/fonts` (SIL Open Font License).
- `assets/img/`: original photos, linked from the photo viewer. `assets/disp/`: smaller copies of a few very large photos, used on the pages.

## Moving the plume

If you change the engine image, update `EXIT` at the top of `assets/js/plume.js` (nozzle exit centre and radius, as fractions of the image) and the matching numbers in `.hero` and `.hero-engine` in `site.css` (`--ih`, `--ew`, and the `0.997` / `0.5017` offsets, in both `.hero-engine` and `.hero-glow`).

## Goblet tour (front page)

The Goblet section is a pinned scene: as you scroll, your render plays from part to part, resting on each one, while a pointer and a line connect the part to its description. It is built by `assets/js/goblet.js`, and everything it needs is in the JSON inside `<script class="gx-config">` in `index.html`. The text for each stop is the `<article class="gx-step">` list just above it.

Each stop has:
- `frame`: the frame of the render the stop rests on.
- `anchor`: where the pointer dot lands, as `[x, y]` fractions of the frame (0 to 1, from the top left), or a list of them for several pointers. `null` hides the pointer.

Other settings in the same JSON: `hold` (the share of each stop's scroll distance spent resting, 0.55), `dim` (how much the rest of the scene darkens around the pointer, 0 to turn it off). The scroll distance per stop is set by `.gx.gx-on { height: ... }` in `site.css`.

### The rendered animation

The tour plays `Goblet Scroll Animation.mp4` (265 frames used, 23.976 fps). Each stop rests on one frame:
overview 0 (0 s), bulkhead 48 (2 s), MOV/MFV 96 (4 s), chamber PT 144 (6 s), igniter 168 (7 s), injector 216 (9 s), chamber 264 (11 s).
Between stops the frames play in order as you scroll; on a stop the scene holds for a while before moving on.

The frames live in `assets/goblet/`:
- `d-0.json` to `d-5.json`: all 265 frames for desktop (920x1080 WebP, cropped to the engine's column), about 45 per pack.
- `m-0.json`, `m-1.json`: every other frame at 552x648 for phones.
- `poster.webp`: frame 0, shown while the packs load and when JavaScript is off.

The video's black was lifted to the page colour (#0A0B0D) when encoding, so the frame edges vanish. The top of each frame fades into the background, as do the sides and the bottom edge, so the render window never shows.

To re-export after changing the animation, run `tools/encode_goblet_frames.py` (needs Python with Pillow, and ffmpeg) with the new video, then update each stop's `frame` and pointer `anchor` in that JSON (anchors are fractions of the 920x1080 cropped frame; a stop can list several).
