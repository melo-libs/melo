import { app } from 'electron'

/* E2E/perf probes launch alongside a running instance — Chromium locks the
   profile, so a shared userData dir would deadlock the second instance,
   and probe preferences must never touch the real ones.

   This lives in its own module imported FIRST from main/index.ts: several
   modules (preferences, updater) capture app.getPath('userData') at import
   time, and ES import hoisting would run them before any statement in the
   entry file's body. */
if (process.env.MELO_USER_DATA) {
  app.setPath('userData', process.env.MELO_USER_DATA)
}
