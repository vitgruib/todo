# Todo Extension

A Chrome/Edge (Manifest V3) todo list that splits work into **Short run** (tasks with a due date) and **Long run** (long-term goals with no due date). When a short-run task's deadline passes, the extension force-opens a focused reminder window and keeps nagging until you deal with it.

## Prerequisites

**Node.js is required** to build this project.

1. Download and install Node.js from [nodejs.org](https://nodejs.org/).
2. Verify with `node -v` and `npm -v`.

## Setup

```bash
npm install
```

## Development

Run the web view (a plain browser build, no extension APIs) with hot reload:

```bash
npm run dev
```

In dev mode there are no `chrome.*` APIs, so reminders are driven by an in-app timer/overlay instead of the background service worker.

## Building for Chrome / Edge

```bash
npm run build
```

This runs a TypeScript type-check and produces a `dist/` folder. Then:

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `dist` folder.

## Features

- **Two categories** — _Short run_ (has a due date) and _Long run_ (no due date). Adding a task gives it a due date; relegating a task drops the due date and moves it to Long run.
- **Flexible due dates** — presets (30 min → 1 week), a custom date & time picker, or "time until due" (e.g. 90 minutes).
- **Live countdown** — each short-run task shows a ticking "Due in …" caption.
- **Due reminders** — when a deadline passes, a focused reminder popup window opens (with an alarm sound) so it can't be missed. It re-nags every 5 minutes — closing and reopening the window each time — until you complete, reschedule, or relegate the task.
- **Push-back counter** — extending a task's deadline (by any amount, via any method) marks it as delayed and shows a "⏳ Delayed N×" badge. Pulling the deadline earlier, or setting a first due date, doesn't count.
- **Archive** — completed tasks move to an archive ordered by completion time; restore or clear them.
- **Settings** — choose the alarm sound.
- **Full-screen view** — open the extension in a full browser tab.
- **Persistence & sync** — data is saved automatically and synced across your computers via your Chrome account (`chrome.storage.sync`, falling back to `chrome.storage.local` for anything past sync's per-key quota; `localStorage` in dev).

## Quality checks

An automated gate guards against regressions. Run the whole thing with:

```bash
npm run check
```

which runs, in order:

| Script                 | Tool                 | What it verifies                                      |
| ---------------------- | -------------------- | ----------------------------------------------------- |
| `npm run typecheck`    | `tsc --noEmit`       | Types are sound.                                      |
| `npm run lint`         | ESLint (flat config) | No lint errors in `src/` and `public/`.               |
| `npm run format:check` | Prettier             | Everything is formatted (`npm run format` fixes it).  |
| `npm run test`         | Vitest               | Functional tests pass (`npm run test:watch` for TDD). |

Functional tests live next to the code they cover (e.g. `src/reminders.test.ts`, which exercises
due-date parsing, countdown/date formatting, and the push-back counting rules).

## Project layout

- `src/` — React + TypeScript UI (components, `hooks/useTodos`, `reminders.ts`).
- `public/background.js` — MV3 service worker: schedules due reminders (`chrome.alarms`), opens the reminder popup window, and plays the alarm sound via an offscreen document.
- `public/manifest.json` — extension manifest (permissions: `storage`, `alarms`, `offscreen`).
