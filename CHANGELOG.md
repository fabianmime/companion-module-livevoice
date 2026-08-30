# Changelog

All notable changes to this Companion module are documented here. Versions follow the module's
`package.json`/`companion/manifest.json` version field, which is bumped on every change per Companion's
requirement that a re-imported module have a new id+version pair.

## 0.3.12

- Toggle preset ("LiveVoice Start & Stop") restored to four stacked state images
  (`bg-idle`/`bg-active`/`bg-offline`/`bg-unknown`) with `enabled` feedback overrides, matching the confirmed
  visual design.
- Documented the remaining Companion-side limitation (feedbacks not carried over when the preset is dragged
  onto a button - [bitfocus/companion#4410](https://github.com/bitfocus/companion/issues/4410)) with the exact
  one-time manual workaround.

## 0.3.9 – 0.3.11

- Investigated why module-defined feedbacks on the "Start & Stop" preset did not appear after dragging it onto
  a button, across several structural variants (stacked image layers, a single image element with
  `base64Image` swapping, a classic `simple`-style preset). Root-caused to the still-open Companion bug above;
  no preset structure avoids it.
- Added the `importInactive` feedback (covers both "inactive" and "offline") to the toggle preset; removed the
  overlapping `importOffline` feedback from that preset to avoid two feedbacks competing for the same image
  element at once.

## 0.3.8 and earlier

- Initial working module: operator-link-only configuration with automatic discovery of API key, client
  identifiers, join code and event/channel info from the operator page HTML.
- Long-lived ActionCable connection with reconnect/backoff and ping/pong keep-alive.
- Actions: Start Import, Stop Import, Toggle Import (toggle rejects on an unknown server state instead of
  guessing).
- Feedbacks and variables driven by real server state (`channel_updated`/`init_event`), not by the last command
  sent.
- Upgraded to `@companion-module/base` 2.1.3 for `layered` (graphics-overhaul) preset/button support.
- Brand identity (icons, logos, key-state button graphics) designed and wired into the presets.
