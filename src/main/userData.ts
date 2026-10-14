import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/* This module must be imported FIRST from main/index.ts: several
   modules (preferences, updater) capture app.getPath('userData') at import
   time. Dev and packaged apps need separate profiles so they can run
   together without sharing settings or Chromium's single-instance lock. */
const profilePath =
  process.env.MELO_USER_DATA ||
  (!app.isPackaged ? join(app.getPath('appData'), 'Melo Dev') : undefined)

if (profilePath) {
  mkdirSync(profilePath, { recursive: true })
  app.setPath('userData', profilePath)
}
