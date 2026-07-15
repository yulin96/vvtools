# VVTools engineering rules

- Use pnpm for dependency and script commands.
- Keep shared contracts in `src/shared`, privileged desktop logic in `src/main`, the allow-listed bridge in `src/preload`, and UI code in `src/renderer`.
- The Electron main-process task queue is the sole source of truth for task execution and state. Renderer stores only mirror task snapshots.
- Run FFmpeg and FFprobe with `child_process.spawn` and argument arrays. Never use `exec`, shell interpolation, base64 media payloads, or whole-file buffering for media work.
- Keep media processors independent of Electron UI code so they can be unit tested.
- Use Tailwind CSS v4 and local shadcn-vue-style components for renderer styling; use `@lucide/vue` for icons.
- Run targeted tests, lint, and type checks after changes. Do not run a build unless the user explicitly requests it.
