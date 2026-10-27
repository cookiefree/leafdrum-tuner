# Leaf Drum Note Finder

A static website that listens through the microphone and tells you which musical note each leaf of a leaf drum (tongue drum) plays.

The app shows a guided 9-group, 27-tongue drum: tap **Start**, then strike the tongue highlighted in the drawing. Each strike fills that tongue with the note name, octave, frequency, and cents offset from the nearest note. The sorted-by-pitch strip updates as you go, and **Copy results** copies the scan as plain text.

All audio processing happens on the device. Nothing is recorded, stored, or sent anywhere.

**Live:** https://cookiefree.github.io/leafdrum-tuner

## How it works

1. Tap **Start** and allow microphone access.
2. The drum drawing highlights the next tongue to play.
3. Strike that tongue once. The app detects the hit, measures the pitch, and writes the result onto the drawing.
4. Repeat until all 27 tongues are filled, or skip ahead to any tongue you want to redo.
5. Tap **Copy results** to get the full scan as plain text.

Each result shows:

| Field | Example |
|---|---|
| Note and octave | `D3` |
| Frequency | `146.8 Hz` |
| Offset from nearest note | `-4 cents` |

Notes use English naming (C D E F G A B), with sharps and flats where a tongue lands on one.

## The drum layout

The guide matches a 9-leaf drum: 8 leaves around the edge and 1 in the center. Each leaf has 3 nested tongues (small, middle, big), which gives 27 tongues in total. The on-screen drawing mirrors this, so the tongue you need to hit is always the highlighted one.

Other drum layouts are not supported yet. Presets for other drum types may come later.

## Song guide

Paste the notes of a song and the app shows which tongues to play and in what order, so you can check whether the song fits your drum. The pasted notes stay in your browser on your device and are never uploaded.

## Tips for a clean scan

- Play in a quiet room and keep the phone close to the drum, but not touching it.
- Strike one tongue at a time and let it ring out before the next hit.
- If your phone mic is quiet, raise the input gain in the app. Quiet phones can otherwise miss soft strikes.
- Very low tongues sit near the bottom of what a phone mic picks up well, so the app ignores everything below a 60 Hz floor.
- If a tongue gets read wrong, redo just that tongue instead of the whole scan.

## Privacy

- Audio is processed locally in the browser with the Web Audio API.
- No audio is recorded or saved.
- No network requests carry audio or results anywhere.
- No accounts, no analytics, no cookies.

## Running locally

It is a plain static site with no build step. Browsers only allow microphone access on `https://` or `localhost`, so open it through a local server rather than straight from the file system:

```bash
git clone https://github.com/cookiefree/leafdrum-tuner.git
cd leafdrum-tuner
python3 -m http.server 8000
```

Then open `http://localhost:8000`. To test on a phone, use the deployed GitHub Pages version (it is served over HTTPS, so the mic works).

## Deployment

The site is hosted on GitHub Pages. Push to the main branch and Pages serves the repo root as-is.

## Browser support

Any modern browser with microphone access and the Web Audio API: current Chrome, Edge, Firefox, and Safari (desktop and mobile).

## Known limitations

- Some tongues are hard to read reliably, especially soft or very low ones. Accuracy depends on the drum, the room, and the phone mic.
- Pitch is measured from the strike, so a muffled or doubled hit can give a wrong note. Strike again if a value looks off.
- Fixed 9-leaf, 27-tongue layout for now.
