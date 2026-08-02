# CodexWhip 1.4.3 Test Plan

## Goal

Remove the short riding crop completely while preserving the remaining four whip styles, task binding, safe Codex delivery, continuous clicking, and Windows packaging behavior.

## Release Gates

1. Source and configuration checks
   - `node --check` passes for production and test JavaScript.
   - The PowerShell parser reports no errors for `scripts/codex-desktop-ui.ps1`.
   - `git diff --check` passes.
   - No `crop`, short-riding-crop, or five-style references remain.
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
   - `npm run dist:win` creates Setup and Portable executables for version 1.4.3.
   - The installed application reports version 1.4.3.
   - Existing binding and phrase files keep their original hashes.
   - A previous `crop` setting resolves to the leather whip.
6. GitHub publication
   - The commit is pushed to `origin/main`.
   - Tag `v1.4.3` points to the pushed commit.
   - Setup and Portable assets are uploaded with matching SHA256 digests.

## Execution Record

| Gate | Result | Evidence |
| --- | --- | --- |
| Source and configuration | Pass | JavaScript checks, PowerShell parsing, and `git diff --check` passed. Production source and packaged `app.asar` contain no crop references. |
| Unit and contract | Pass | `npm test`: 43 tests passed, including removed-style fallback, scheduler, binding, draft protection, and guarded delivery. |
| Overlay and performance | Pass | Four styles rendered; highest P95 render cost was 0.6ms, highest P95 frame interval was 33.5ms, and idle repaint delta was 0 frames. |
| Assets and documentation | Pass | Four-style cover and showcase regenerated; four distinct WAV files passed validation; the crop WAV is deleted. |
| Packaging | Pass | Production audit reported 0 vulnerabilities; npm dry-run contained 43 files; Setup and Portable 1.4.3 built successfully. |
| Installed application | Pass | `D:\APP\CodexWhip` reports 1.4.3; binding, phrase, and settings hashes were unchanged; the legacy crop setting displayed the leather whip; right click hid the overlay. |
| GitHub publication | Pending | Push, tag, release, and uploaded asset digests are the final release actions. |
