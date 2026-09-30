# CodexWhip 1.5.1 Test Plan

## Goal

Keep the four whip styles and guarded delivery behavior while restoring compatibility with the current ChatGPT/Codex desktop accessibility trees on macOS and Windows. The 1.5.1 patch also updates the regression fixtures used for the migrated sidebar and composer selectors.

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
   - `npm run dist:win` creates Setup and Portable executables for version 1.5.1.
   - The installed application reports version 1.5.1.
   - Existing binding and phrase files keep their original hashes.
   - A previous `crop` setting resolves to the leather whip.
6. GitHub publication
   - The commit is pushed to `origin/main`.
   - A release tag and packaged Setup/Portable assets are created only after the platform packaging gates pass.

## Execution Record

| Gate | Result | Evidence |
| --- | --- | --- |
| Source and configuration | Partial | JavaScript syntax checks, Swift helper compilation, and `git diff --check` pass; macOS live probe returns `READY`; Windows UIA parser and live probe remain unverified on this host. |
| Unit and contract | Pass | `npm test`: 52 tests passed sequentially, including the current AX fixture and migrated UIA contract tests. |
| Overlay and performance | Pending | Recheck four-style rendering, click interactions, close controls, frame cost, and idle repainting. |
| Assets and documentation | Pending | Existing four-style assets remain covered; rerun the asset and documentation checks for the 1.5.1 package. |
| Packaging | Pending | Run the production audit and build the 1.5.1 Setup and Portable artifacts. |
| Installed application | Pending | Install the 1.5.1 artifact and verify binding, phrase, settings, and right-click behavior. |
| GitHub publication | Pending | Push, tag, release, and uploaded asset digests are the final release actions. |
