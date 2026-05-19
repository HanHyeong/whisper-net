import fs from 'fs'
import path from 'path'
import { app } from 'electron'

interface AppConfig {
  nickname: string
  sharedPath: string
}

const defaultConfig: AppConfig = {
  nickname: '',
  sharedPath: '',
}

export function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'whisper-config.json')
}

export function loadConfig(): AppConfig {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8')
    return { ...defaultConfig, ...JSON.parse(raw) }
  } catch {
    return { ...defaultConfig }
  }
}

export function saveConfig(config: Partial<AppConfig>) {
  const current = loadConfig()
  const next = { ...current, ...config }
  fs.writeFileSync(getConfigPath(), JSON.stringify(next, null, 2))
}
