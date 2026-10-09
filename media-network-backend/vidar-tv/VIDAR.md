# Vidar TV app

Fork of Google's **JetStreamCompose** sample
(https://github.com/android/tv-samples/tree/main/JetStreamCompose, Apache-2.0 —
see `LICENSES.md`; original copyright headers kept).

## Changes so far
- App name → "Vidar", applicationId → `com.vidar.tv`, project → `VidarTV`
  (Kotlin package `com.google.jetstream` kept for now to keep the diff small)

## Next (VIDAR_PLAN.md Phase 4B)
1. Rebrand: logo/wordmark, Vidar color scheme, ES/EN strings
2. Swap the sample JSON data layer (`data/`) for the Jellyfin Kotlin SDK
3. Live tab (Jellyfin Live TV / free FAST channels)
4. Media3 playback from Jellyfin URLs, resume sync, ES audio/subs default

## Build
Requires Android Studio (or JDK 17 + Android SDK). From this folder:
`./gradlew :jetstream:assembleDebug` → `jetstream/build/outputs/apk/debug/`
Install: `adb install -r jetstream-debug.apk`
