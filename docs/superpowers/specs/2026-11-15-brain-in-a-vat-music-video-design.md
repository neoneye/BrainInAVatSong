# Brain in a Vat: music video design

## Intent
A music video for the song in `assets/song.mp3` (343 s, 140 BPM danish eurodance duet): a love story between two
brains in neighbouring jars. The lyrics are raunchy and funny; the picture plays it as **dark lab horror**, so the jokes
land as gallows humour and the bridge ("two empty jars… one was marked with you") is a real nightmare.

## Decided by Simon
- Tone: dark lab horror.
- Glass shatter: once, at the bridge.
- Simulation scenes: full-screen, the lovers are simple figures with brains for heads.
- The forked P(doom) code is replaced.
- `brain-in-a-vat` is the base for the two brains and must become much more expressive.
- `ink-chromatography` and `watercolor-text` carry love texts exposed to water.
- `dust` draws romantic messages in dust, on a dusty jar with a brain behind it.
- Subtitles appear in several different formats.
- Three YouTube thumbnail candidates; every prompt saved in `prompts/`.

## Approaches
1. **Scene engine as in NoOffSwitch (chosen).** three.js engine, one module per world, a beat-snapped shot list, frames
   rendered deterministically in headless Chrome. Each experiment in `assets/` is ported to a scene module. Already
   proven on a previous video and lets scenes be built in parallel.
2. Screen-record the experiments and edit. Fast, but nothing reacts to the song and the brains stay inexpressive.
3. The p5.brush pipeline that came with the fork. Wrong look: the assets are WebGL/three.js.

## Design (Claude's calls unless listed above)
- 1920×1080, 30 fps, full colour, graded dark: vignette, grain, colour fringing, fluorescent flicker, glitch on hits.
- Scenes: `lab` (the two jars), `sim` (the too-bright simulation), `shatter` (a jar breaking), `water` (watercolour
  lettering), `ink` (handwritten notes separating in water), `dust` (messages drawn in dust over the jar),
  `terminal` (the rap break).
- She: pale pink brain, jar with a patched leak. He: darker, scarred brain, murkier jar. Singer per line is a guess
  (her: verses, pre-chorus, bridge; him: rap; both: chorus) and is one field per line in `video/src/lyrics.js`.
- Subtitle formats by section: fogged-glass whisper, specimen label, handwritten note, large serif karaoke, terminal
  type, plain caption.
- Suggestive, never explicit.
- Thumbnails in `docs/thumbnails/`.
