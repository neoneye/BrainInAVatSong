# Scene contract (read before writing a scene)

The video for the brain-in-a-vat song (assets/song.mp3, 343.16 s, 139.87 BPM) is rendered by `video/src/engine.js` with
three.js 0.170. Each visual world is a **scene module** in `video/src/scenes/<name>.js`. The timeline
(`video/src/timeline.js`) cuts between shots; each shot names a scene plus a `mode` and other parameters. The engine
renders the shot into a 1920×1080 render target, then a post pass (`video/src/post.js`) adds vignette, film grain,
colour fringing, flicker and glitches, and draws the subtitles on top (mostly in the bottom ~220 px; keep the subject's
important parts above y ≈ 840 px).

**Story and tone.** Two brains in neighbouring jars on a lab shelf are in love. SHE (pale pink brain, her jar has a
patched crack that leaks) and HE (darker, scarred brain, murkier fluid). They meet in a simulation (a beach house).
The song is raunchy and funny but the picture is **dark lab horror**: near-black room, sickly green/amber fluid lit
from below, flickering fluorescent light, cold steel, something clinical and wrong. Never cute, never bright (except
the simulation, which is too bright and glitches). Suggestive, never explicit.

## Module shape

```js
// video/src/scenes/<name>.js  (ES module; `import * as THREE from 'three'` and 'three/addons/...' work)
export const meta = { modes: ['wide', 'her'] };   // documentation for the timeline author: list every mode and parameter
export async function create(ctx) {
  // ctx = { THREE, renderer, width: 1920, height: 1080, base }   base = URL of the repo root (assets/ lives there)
  // Build everything expensive here (or lazily, cached). Called once at load.
  return {
    scene, camera,             // A: engine calls renderer.render(scene, camera) into its render target, or
    // render(renderer, target) // B: draw it yourself into `target` (a THREE.WebGLRenderTarget), or
    // canvas                   // C: your own canvas (own GL context, preserveDrawingBuffer: true); uploaded after update()
    update(t, shot) { ... },   // called once per frame, right before rendering
  };
}
```

`shot` passed to `update` contains:

| field | meaning |
|---|---|
| `t` | song time in seconds (same as the first argument) |
| `mode`, `seed`, `text`, … | from the timeline: any parameter the timeline author sets on the shot is passed through |
| `t0`, `lt`, `dur`, `p` | shot start (song time), seconds since the shot started, shot length, `lt / dur` |
| `beat` | `{ bpm, period, index, phase, pulse, bar, barPhase }`; `pulse` is 1 on each beat and decays |
| `energy` | 0..1 smoothed loudness of the song |
| `onset` | 0..~1.5 onset strength (drum hits) at t |
| `sing` | 0..1, 1 while a word is being pronounced |
| `who` | who sings the current line: `'her'`, `'him'`, `'both'` or `''` |
| `word`, `line` | the current word and lyric line (`line.sec` is the section: Verse 1, Chorus, Rap, Bridge, …; `line.words` = `[[word, t0, t1], …]`) |
| `backdrop` | a THREE.Texture (1920×1080, sRGB) of another scene rendered this frame, when the timeline gives the shot a `behind` scene; otherwise null |

Helpers you may import from `../engine.js`: `beatAt(t)`, `energyAt(t)`, `onsetAt(t)`, `voiceAt(t)` (→ `{sing, word, line}`),
and from `../audio.js`: `BEAT`, `BEAT0`, `DUR`. These let you compute things at other times than `t` (e.g. schedule
events on beats inside a shot: beat k is at `BEAT0 + k * BEAT`).

## Rules

- **Determinism.** The same `(t, shot)` must give the same image no matter which frames were rendered before, because
  the renderer seeks around (contact sheets, parallel workers each rendering a different stretch of the song).
  Animate as a function of `t`/`lt`. No `Math.random()` and no wall-clock time at update time; use a seeded RNG keyed
  by `shot.seed`.
- **Simulations that need stepping** (fluid, physics): keep a fixed timestep and your own `simT`. In `update`, if the
  shot identity (`shot.t0`) changed or `shot.lt < simT`, reset the simulation to its seeded initial state; then step
  with the fixed dt until `simT >= shot.lt`. Sequential rendering is then cheap and a seek costs one catch-up. Keep a
  catch-up of a 15 s shot under ~10 s. Everything that drives the simulation (drops, impacts) must be a function of
  shot-local or song time, never of frame count. Physics that can be precomputed at create time (cached per seed) is better.
- **Speed.** Aim for under ~80 ms per frame and never over ~400 ms.
- **Same scene, different shot.** Consecutive shots of the same scene are hard cuts. Never share mutable state between
  scene modules.
- **No UI.** Never show the experiment's parameters, panels, labels, captions or HUD text. No lyric subtitles either
  (the engine draws those); text that belongs to the world (a jar label, a note) is fine.
- **Big and readable.** The video is watched small. Subjects fill the frame; strong key light and rim light against the dark.
- Don't modify files outside your scene (`video/src/scenes/<name>.js` plus an optional folder
  `video/src/scenes/<name>/` for helpers). If a shared file needs a change, say so in your report.
  Do not touch `assets/` (read-only source material), do not run git commands that change anything.
- No network at render time: three.js comes from node_modules via the import map. Fonts available (already loaded by
  the page): "IBM Plex Mono", "Caveat" (handwriting), "Playfair Display" (serif), weights 400 and 700.

## Checking your work (run from the repo root, /Users/neoneye/git/musicvideo/BrainInAVatSong)

```
node video/render.mjs --q="scene=lab&mode=her" --sheet=30,31,32,60,61,62 --out=out/check/lab_her.jpg
node video/render.mjs --q="scene=lab&mode=her" --stills=60 --out=out/check/lab_her_full
node video/render.mjs --q="scene=lab&mode=her" --clip=60:70 --out=out/check/lab_her.mp4
```

With `scene=` the whole song is one shot of that scene starting at t = 0, so `t` is song time and `lt == t` (beat,
energy, sing, who and word all work). Extra shot parameters: `&text=...` (URL-encoded; `|` separates lines) and any
other `&key=value` is passed through on the shot (numbers are parsed). The sheet prints ms per frame. Open the JPEGs
with the Read tool and look hard: is the subject readable at 640 px wide? Is it dark and unsettling? Does it move to
the music? Check determinism: render the same time twice in different orders (`--sheet=40,10,40`) and compare.
Write your check images under `out/check/<name>…` only. Several agents are working in parallel on other scenes in
this repo, so expect other scene files to appear and do not wait on or edit them.

## Report
End with: the modes and parameters your scene supports (one line each, with what it shows and any timing cues such
as "impact at lt = shot.hit"), ms per frame, and anything that does not work yet.
