# VVTools engineering rules

- Use pnpm for dependency and script commands.
- Keep shared contracts in `src/shared`, privileged desktop logic in `src/main`, the allow-listed bridge in `src/preload`, and UI code in `src/renderer`.
- The Electron main-process task queue is the sole source of truth for task execution and state. Renderer stores only mirror task snapshots.
- Run FFmpeg and FFprobe with `child_process.spawn` and argument arrays. Never use `exec`, shell interpolation, base64 media payloads, or whole-file buffering for media work.
- Keep media processors independent of Electron UI code so they can be unit tested.
- Keep VVTools single-instance; a second launch must focus the existing main window.
- When output conflicts are skipped, keep those files in the pending list and explain why they did not start. When overwrite mode is enabled, show a non-blocking warning at the top of every processing workspace; after processing succeeds, move the existing output to the system trash before committing the new output, and do not interrupt submission with a confirmation dialog.
- Keep one stable row per current-batch item: staged, queued, processing, retried, and settled states update in place and preserve input order; do not expose a task-history list or a separate reprocess action. A settled batch stays in the list, and the main start button resubmits its source files with current settings when no new files are staged. Adding files after the whole batch settles starts a new batch and clears the previous results.
- Keep output suffix settings independent for image, video, audio, PDF, and font processing. Migrate a legacy global suffix into every processing workspace.
- Keep batch rename as two persisted modes: plain visible-order numbering and composable custom rules. Persist its rules and sorting; the renderer owns live name previews, while the main process validates paths and conflicts and performs same-directory two-phase renames with rollback. Never overwrite an unrelated existing file or rename a file used by an active media task.
- Use Tailwind CSS v4 and local shadcn-vue-style components for renderer styling; use `@lucide/vue` for icons.
- Run targeted tests, lint, and type checks after changes. Do not run a build unless the user explicitly requests it.

## Release rules

- GitHub releases are triggered by semantic version tags such as `v0.1.0`; the tag must match the `package.json` version.
- Keep `.github/workflows/release.yml` capable of producing native macOS ARM64/x64, Windows x64, and Linux x64 packages. Each job must stage FFmpeg and FFprobe on the matching native architecture.
- Keep `release-notes.md` as the versioned user-facing changelog with `## 未发布` at the top. Update that section in the same change whenever functionality, UI, behavior, compatibility, or a user-visible bug fix changes. Do not add test-only, formatting, pure refactoring, or internal build entries.
- Publish with `pnpm release:patch`, `pnpm release:minor`, `pnpm release:major`, or `pnpm release X.Y.Z`. The command archives `未发布`, validates, commits, tags, and pushes; release automation extracts only the matching version.
- GitHub Actions uploads versioned packages and update manifests to OSS, while GitHub Releases remain the release archive. The public `VVTOOLS_UPDATE_BASE_URL` path must match `OSS_RELEASE_PREFIX`.
- Windows and Linux use the OSS/CDN updater metadata for in-app download and installation. Until macOS packages are signed and notarized, macOS checks the OSS manifest and opens the matching OSS DMG.
- Never commit signing credentials or generated `dist`, `.release`, or `.media-bin` artifacts.
