import type { DisplayRotation } from '@shared/protocol.ts'
import { ChevronLeft } from 'lucide-react'
import { useState } from 'react'
import type { ThemePreference } from '../hooks/useTheme.ts'
import type { AudioOutput } from '../types.ts'
import ConfirmDialog from './ConfirmDialog.tsx'

interface SettingsPageProps {
  audioOutput: AudioOutput
  displayRotation: DisplayRotation
  themePreference: ThemePreference
  onThemeChange: (preference: ThemePreference) => void
  onAudioOutputChange: (output: AudioOutput) => void
  onDisplayRotationChange: (degrees: DisplayRotation) => void
  onReset: () => void
  onClose: () => void
}

export default function SettingsPage({
  audioOutput,
  displayRotation,
  themePreference,
  onThemeChange,
  onAudioOutputChange,
  onDisplayRotationChange,
  onReset,
  onClose
}: SettingsPageProps) {
  const [confirmReset, setConfirmReset] = useState(false)

  return (
    <main className="settings-page">
      <div className="settings-column">
        <div className="settings-header">
          <button type="button" onClick={onClose} className="icon-button" aria-label="Back to chat">
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <h1 className="settings-title">Settings</h1>
        </div>
        <section className="settings-card">
          <h2 className="settings-card-title">Appearance</h2>
          <p className="settings-card-copy">Choose a warm mode, or follow this device.</p>
          <div className="settings-choice-grid settings-theme-grid">
            {(['light', 'dark', 'system'] as const).map((theme) => (
              <button
                key={theme}
                type="button"
                onClick={() => onThemeChange(theme)}
                className={`settings-choice ${themePreference === theme ? 'is-selected' : ''}`}
              >
                {theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : 'System'}
              </button>
            ))}
          </div>
        </section>
        <section className="settings-card">
          <h2 className="settings-card-title">Audio Output</h2>
          <p className="settings-card-copy">Phone is the default. Device keeps the kiosk as the audible sink.</p>
          <div className="settings-choice-grid">
            {(['phone', 'device'] as const).map((output) => (
              <button
                key={output}
                type="button"
                onClick={() => onAudioOutputChange(output)}
                className={`settings-choice ${audioOutput === output ? 'is-selected' : ''}`}
              >
                {output === 'phone' ? 'Phone' : 'Device'}
              </button>
            ))}
          </div>
        </section>
        <section className="settings-card">
          <h2 className="settings-card-title">Screen Rotation</h2>
          <p className="settings-card-copy">Rotate the kiosk display to match its mounting.</p>
          <div className="settings-choice-grid">
            {([0, 90, 180, 270] as const).map((degrees) => (
              <button
                key={degrees}
                type="button"
                onClick={() => onDisplayRotationChange(degrees)}
                className={`settings-choice ${displayRotation === degrees ? 'is-selected' : ''}`}
              >
                {degrees}°
              </button>
            ))}
          </div>
        </section>
        <section className="settings-card">
          <h2 className="settings-card-title">Connection</h2>
          <p className="connection-host">Server: {window.location.origin}</p>
          <p className="settings-card-copy">Open this address from the QR code on the same hotspot.</p>
        </section>
        <section className="settings-card is-danger">
          <h2 className="settings-card-title">Conversation History</h2>
          <p className="settings-card-copy">This only clears the active conversation.</p>
          <button type="button" onClick={() => setConfirmReset(true)} className="danger-button reset-button">
            Reset Active History
          </button>
        </section>
      </div>
      <ConfirmDialog
        open={confirmReset}
        message="Clear this conversation's history? This can't be undone."
        onConfirm={() => {
          setConfirmReset(false)
          onReset()
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </main>
  )
}
