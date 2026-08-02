# CodexWhip 1.4.1 Test Plan

## Goal

Prove that a physical left-button press is never silently discarded while keeping the existing Codex task-binding and safe-delivery guarantees. Rapid clicks may be coalesced into one pending whip, but the program must report that state and automatically deliver it after the active send and cooldown complete.

## Release Gates

The release is allowed only when every gate below passes on Windows:

1. Source and configuration checks
   - `node --check` passes for production and test JavaScript.
   - PowerShell parser reports no errors for `scripts/codex-desktop-ui.ps1`.
   - `git diff --check` passes.
   - No credential-like material is staged.
2. Unit and contract tests
   - `npm test` is fully green.
   - The first whip request runs immediately.
   - Requests during an active send or cooldown create exactly one pending send.
   - Repeated rapid clicks do not create an unbounded queue.
   - The pending send starts automatically after both the active send and cooldown finish.
   - Scheduler disposal cancels pending work.
3. Overlay interaction tests
   - One physical left-button down event produces exactly one IPC request.
   - The send request does not depend on receiving `mouseup`.
   - A quick left click followed by right-click close still preserves the left-click request.
   - Right click and `Esc` still close the overlay.
   - The overlay remains available after a successful or queued send.
4. Codex safety regression
   - Unbound, draft-present, task-mismatch, ambiguous-title, focus-change, permission-mismatch, and unconfirmed-delivery paths send no text or Enter.
   - Exact task title and runtime ID checks remain in the same guarded UI Automation transaction.
   - Duplicate phrase text never causes an old message node to be selected.
   - Codex `config.toml` remains read-only and requires official `Steer` mode.
5. Visual and performance regression
   - All five styles render with the production preload and real IPC bridge.
   - 1080p at 100%, 125%, and 150%, plus 1440p at 200%, produce nonblank captures.
   - Each style keeps P95 render cost below 33ms and P95 frame interval at or below 34ms.
   - Static whips stop continuous repainting.
6. Assets and packaging
   - Five distinct WAV files and all required icon sizes are present.
   - `npm audit --omit=dev` reports zero production vulnerabilities.
   - `npm pack --dry-run --json` includes all runtime files.
   - `npm run dist:win` creates Setup and Portable executables for version 1.4.1.
   - Packaged `app.asar` reports version 1.4.1.
7. Installed application smoke test
   - Install over `D:\APP\CodexWhip` without changing `binding.json` or `phrases.json`.
   - Installed application starts and remains resident in the tray.
   - All five styles load from the installed build.
   - With the binding temporarily held aside, left click animates and requests a send without transmitting to Codex.
   - Rapid clicks show queued behavior and produce one deferred send attempt, not silent loss.
   - Right click and `Esc` hide the overlay while the tray process remains running.
   - Restore the original binding byte-for-byte after testing.
8. GitHub publication
   - Commit is pushed to `origin/main`.
   - Tag `v1.4.1` points to the pushed commit.
   - Setup and Portable assets are uploaded with matching SHA256 digests.
   - The release is public, non-draft, and marked latest.

## Execution Record

| Gate | Result | Evidence |
| --- | --- | --- |
| Source and configuration | Pass | 21 JavaScript files passed `node --check`; PowerShell parser returned zero errors; `git diff --check` passed. |
| Unit and contract | Pass | `npm test`: 43 tests passed, including active-send, cooldown, long-send, observer-failure, disposal, and one-slot coalescing cases. |
| Overlay interaction | Pass | Production preload smoke: single press = 1 IPC, three rapid presses = 3 IPC requests, left-then-right preserved 1 request, right close emitted `hide-overlay`. |
| Codex safety | Pass | Existing guarded-send tests passed; live probe returned `READY`, a unique task title, matching saved binding, runtime ID present, and no draft. No real Codex message was transmitted during destructive interaction tests. |
| Visual and performance | Pass | Five styles passed; highest P95 render cost 0.8ms, highest P95 frame interval 33.5ms; all four viewport captures were nonblank; idle repaint delta was 0 frames. |
| Assets and packaging | Pass | Production audit total 0; npm dry-run contained 44 files; Setup and Portable built; packaged and installed `app.asar` reported 1.4.1. |
| Installed application | Pass | Over-installed at `D:\APP\CodexWhip`; binding and phrase hashes were unchanged; final three-click log showed queued, coalesced, and one automatic drain; right click and `Esc` hid the overlay while tray processes remained. |
| GitHub publication | Release-time gate | Verify pushed commit, tag target, public latest release, asset sizes, and GitHub SHA256 digests after publication. |
