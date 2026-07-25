import { useEffect, useState } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = Exclude<ThemePreference, 'system'>

const STORAGE_KEY = 'sahurhub-theme'

function readPreference(): ThemePreference {
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== 'system') return preference
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readPreference)
  const [theme, setTheme] = useState<ResolvedTheme>(() => resolveTheme(readPreference()))

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => setTheme(resolveTheme(preference))
    applyTheme()
    if (preference === 'system') media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [preference])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(STORAGE_KEY, preference)
  }, [preference, theme])

  return { preference, setPreference, theme }
}
