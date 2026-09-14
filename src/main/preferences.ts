import { app } from 'electron'
import fs from 'fs-extra'
import path from 'path'

interface Preferences {
  ignoredVersion?: string
  // Add other preferences here as needed
  [key: string]: any
}

class PreferencesManager {
  private static instance: PreferencesManager
  private filePath: string
  private cache: Preferences = {}

  private constructor() {
    this.filePath = path.join(app.getPath('userData'), 'preferences.json')
    this.loadPreferences()
  }

  public static getInstance(): PreferencesManager {
    if (!PreferencesManager.instance) {
      PreferencesManager.instance = new PreferencesManager()
    }
    return PreferencesManager.instance
  }

  private loadPreferences(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf8')
        this.cache = JSON.parse(data)
      }
    } catch (error) {
      console.error('Error loading preferences:', error)
      this.cache = {}
    }
  }

  private savePreferences(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2))
    } catch (error) {
      console.error('Error saving preferences:', error)
    }
  }

  public get<T>(key: string): T | null {
    return this.cache[key] as T
  }

  public set<T>(key: string, value: T): void {
    this.cache[key] = value
    this.savePreferences()
  }

  public delete(key: string): void {
    delete this.cache[key]
    this.savePreferences()
  }

  public clear(): void {
    this.cache = {}
    this.savePreferences()
  }
}

export const preferences = PreferencesManager.getInstance()
