import type { ConnectionState } from '../types.ts'

export default function ConnectionPill({ connection }: { connection: ConnectionState }) {
  const label = connection === 'connected' ? 'Connected' : connection === 'connecting' ? 'Connecting…' : 'Offline'
  const state = connection === 'connected' ? 'connected' : connection === 'connecting' ? 'connecting' : 'disconnected'

  return (
    <span className="connection-indicator" title={label} aria-label={`Connection status: ${label}`}>
      <span className={`connection-dot is-${state}`} aria-hidden="true" />
      <span className="connection-label">{label}</span>
    </span>
  )
}
