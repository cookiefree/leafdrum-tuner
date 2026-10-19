# Leaf Drum Note Finder

A static website that listens through the microphone and tells you which musical note each leaf of a leaf drum (tongue drum) plays. The app shows a guided 9-group, 27-tongue drum: tap Start, then strike the tongue highlighted in the drawing. Each strike fills that tongue with the note name, octave, frequency, and cents offset from the nearest note. The sorted-by-pitch strip updates as you go, and Copy results copies the scan as plain text. All audio processing happens on the device; nothing is recorded, stored, or sent anywhere.

## Run locally

Serve the folder over HTTP:

```
python3 -m http.server 8000
```

On Windows, use `python -m http.server 8000` if `python3` is not available. Then open http://localhost:8000 in a desktop browser (Chrome or Firefox).

The microphone only works in a secure context (HTTPS or localhost), so open the app through the server URL. Opening `index.html` directly from the file system will not work.

## Deploy to GitHub Pages

1. Push this repository to GitHub as a public repository named `leafdrum-tuner`.
2. In the repository, open Settings, then Pages.
3. Under "Build and deployment", set Source to "Deploy from a branch", pick branch `main` and folder `/ (root)`, then save.
4. Wait for the first deployment to finish, then open the live URL on your phone.

All asset paths are relative, so the site works from the project subpath (for example `https://<user>.github.io/leafdrum-tuner/`).

Live URL: https://cookiefree.github.io/leafdrum-tuner/
