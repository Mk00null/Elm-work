# Vidar TV app

Fork of Google's **JetStreamCompose** sample
(https://github.com/android/tv-samples/tree/main/JetStreamCompose, Apache-2.0 —
see `LICENSES.md`; original copyright headers kept).

## Changes so far
- App name → "Vidar", applicationId → `com.vidar.tv`, project → `VidarTV`
  (Kotlin package `com.google.jetstream` kept for now to keep the diff small)

- Theme → Vidar palette: charcoal #111216/#1C1D22, indigo #9AA0F0 on #3A4192 (focus border #5E66BC), magenta accent #F070E0, tan #B9B08E, red #FF8A80; wordmark "VIDAR"

## Next (VIDAR_PLAN.md Phase 4B)
1. Rebrand: logo/wordmark, Vidar color scheme, ES/EN strings
2. Swap the sample JSON data layer (`data/`) for the Jellyfin Kotlin SDK
3. Live tab (Jellyfin Live TV / free FAST channels)
4. Media3 playback from Jellyfin URLs, resume sync, ES audio/subs default

## Build
Requires Android Studio (or JDK 17 + Android SDK). From this folder:
`./gradlew :jetstream:assembleDebug` → `jetstream/build/outputs/apk/debug/`
Install: `adb install -r jetstream-debug.apk`

## Using your own logo image (private)
The top-bar logo loads `jetstream/src/main/res/drawable-nodpi/vidar_logo.png`
(default: the original emblem in `branding/`). To use a different image on
your own boxes, overwrite that file locally with a square transparent PNG
(512×512 recommended) and rebuild. For the launcher icon, use Android Studio →
New → Image Asset with the same file. Keep third-party artwork out of commits.
