# Sounds (temporary samples)

This folder contains temporary, royalty-free synthesized samples used by the standalone tools until final assets are provided.

- tick.wav: short percussive tick (~1400 Hz sine, 90 ms)
- win.wav: short celebratory chord (C major triad, ~600 ms)

How to replace:
1) Put your final audio files here (recommended formats: WAV or OGG, short and normalized).
2) Keep the same filenames (tick.wav, win.wav) or update the wheel page JS to point to your chosen names.
3) Make sure Content-Security-Policy allows `media-src 'self'` (already configured in main.js).