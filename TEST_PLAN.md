# CodexWhip 1.5.5 Test Plan

## Goal

Keep the four whip styles and guarded delivery behavior while restoring compatibility with the current ChatGPT/Codex desktop accessibility trees on macOS and Windows. The 1.5.5 patch also explains when the active window has no Codex composer and opens the macOS phrase library directly in TextEdit.

## Release Gates

1. Source and configuration checks
   - `node --check` passes for production and test JavaScript.
   - The PowerShell parser reports no errors for `scripts/codex-desktop-ui.ps1`.
   - `git diff --check` passes.
   - No `crop`, short-riding-crop, or five-style references remain.
   - macOS AX fixture covers the current `AXWebArea` document title, `sidebar-item` row, selected-state marker, and `AXTextArea` composer.
   - Windows UIA helper accepts selected sidebar rows exposed as Button, ListItem, TreeItem, or DataItem and rejects unrelated app-shell tabs.
2. Unit and contract tests
   - `npm test` is fully green.
   - The public style registry contains only `leather`, `flogger`, `chain`, and `cyber`.
   - A saved removed style falls back to `leather`.
   - Existing scheduler, binding, draft protection, and guarded delivery tests remain green.
3. Overlay interaction and performance
   - All four styles render through the production preload and IPC bridge.
   - Single click, rapid clicks, and left-then-right interactions preserve their request counts.
   - Right click and `Esc` close the overlay.
   - Each style keeps P95 render cost below 33ms and frame interval at or below 34ms.
   - Static whips stop continuous repainting.
4. Assets and documentation
   - The style showcase and cover both describe four styles.
   - Four distinct WAV files are present and referenced; `sounds/crop.wav` is absent.
   - README and settings documentation do not advertise `crop`.
5. Packaging and installation
   - `npm audit --omit=dev` reports zero production vulnerabilities.
   - `npm run dist:win` creates Setup and Portable executables for version 1.5.5.
   - The installed application reports version 1.5.5.
   - Existing binding and phrase files keep their original hashes.
   - A previous `crop` setting resolves to the leather whip.
6. GitHub publication
   - The commit is pushed to `origin/main`.
   - A release tag and packaged Setup/Portable assets are created only after the platform packaging gates pass.

## Execution Record

| Gate | Result | Evidence |
| --- | --- | --- |
| Source and configuration | Pass | JavaScript tests, Swift helper compilation, `git diff --check`, the current AX fixture, and the mock bound-send flow pass; live Codex probing was intentionally not repeated against the user's active session. |
| Unit and contract | Pass | `npm test`: 62 tests passed sequentially, including binding→whip→send mocks, phrase-editor recovery, the current AX fixture, and migrated UIA contract tests. |
| Overlay and performance | Partial | Visual smoke confirms click counts, close controls, four-style activation, viewport rendering, and idle repaint stop; the host's frame cadence exceeded the 34ms smoke threshold for several styles. |
| Assets and documentation | Pass | Existing four-style assets remain covered; README and test-plan references are aligned with the 1.5.5 package. |
| Packaging | Pass | `npm run dist:mac` created the 1.5.5 arm64 DMG and ZIP; the installed app reports 1.5.5 and its helper hash matches the build. |
| Installed application | Partial | The installed 1.5.5 overlay visibly exposes style/action controls and the always-visible send status; real binding/send was not exercised against the user's active Codex session. |
| GitHub publication | Pending | Commit and push the 1.5.5 binding guidance and macOS phrase-editor change. |
