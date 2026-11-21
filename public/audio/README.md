# Audio

All sound effects (engine, impacts, warp, wind, Mentat chime) are synthesised in
code by `src/core/AudioManager.ts`: there are no effect files to add.

## Background music (optional)

Drop one track here, named exactly:

    public/audio/music.mp3

- It loops, and is automatically held at about 40% of the ship's loudness
  (`src/core/MusicPlayer.ts` measures it and adjusts), so a quiet or loud track
  both work. The debug panel's Audio folder has a "music (x ship)" slider,
  plus volume and mute.
- If the file is missing or cannot be played, the game falls back to a desert
  score generated in code (drone + Phrygian-dominant melody). Nothing breaks.
- Licence: CC0 or CC-BY only (e.g. OpenGameArt.org or freesound.org filtered
  to CC0; search "desert ambient" or "middle eastern ambient"). Never the Dune
  film score or any other copyrighted track. Credit it in ASSETS_AND_CREDITS.md
  (title, artist, URL, licence) before the demo.
- Browsers only start audio after a click or key press, so the music begins
  on your first click or keystroke on the title screen.
