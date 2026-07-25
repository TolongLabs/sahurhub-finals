import { Check, Info, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Task } from '../types.ts'

interface TasksDrawerProps {
  open: boolean
  tasks: Task[]
  onClose: () => void
  onTaskAction: (taskId: string, action: 'done' | 'discard') => void
}

function remainingTime(task: Task, now: number): string | null {
  if (task.nextWakeAt === null || task.status === 'done' || task.status === 'dismissed' || task.status === 'missed') {
    return null
  }
  const seconds = Math.ceil((task.nextWakeAt - now) / 1000)
  if (seconds <= 0) return 'now'
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export default function TasksDrawer({ open, tasks, onClose, onTaskAction }: TasksDrawerProps) {
  const drawerRef = useRef<HTMLElement>(null)
  const [now, setNow] = useState(() => Date.now())
  const [tooltipOpen, setTooltipOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!drawerRef.current?.contains(event.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', closeOnOutsidePress)
    return () => window.removeEventListener('pointerdown', closeOnOutsidePress)
  }, [onClose, open])

  useEffect(() => {
    if (!tasks.some((task) => task.nextWakeAt !== null)) return
    setNow(Date.now())
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [tasks])

  return (
    <>
      {open && <div aria-hidden="true" className="drawer-scrim" />}
      <aside ref={drawerRef} aria-hidden={!open} className={`drawer tasks-drawer ${open ? 'is-open' : 'is-closed'}`}>
        <div className="drawer-header">
          <div className="tasks-heading-wrap">
            <h2 className="drawer-heading">Tasks</h2>
            <button
              type="button"
              aria-describedby="task-lifecycle-tooltip"
              aria-expanded={tooltipOpen}
              aria-label="Explain task lifecycle"
              className="task-info-button"
              onClick={() => setTooltipOpen((isOpen) => !isOpen)}
              onFocus={() => setTooltipOpen(true)}
              onBlur={() => setTooltipOpen(false)}
              onPointerEnter={() => setTooltipOpen(true)}
              onPointerLeave={() => setTooltipOpen(false)}
            >
              <Info size={16} aria-hidden="true" />
            </button>
            {tooltipOpen && (
              <div id="task-lifecycle-tooltip" role="tooltip" className="task-lifecycle-tooltip">
                <span>Tasks capture from chat.</span>
                <span>Pending → Reminding → Escalated ×2.</span>
                <span>Each reminder waits the task duration.</span>
                <span>Missed stops; say done or use the buttons.</span>
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close tasks" className="icon-button">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <ul className="task-list">
          {tasks.length === 0 && <li className="task-meta">No active tasks.</li>}
          {tasks.map((task) => (
            <li key={task.taskId} className="task-row">
              <div className="task-row-content">
                <p className="task-name">{task.taskName}</p>
                <p className="task-meta">
                  {remainingTime(task, now) && <span className="task-countdown">{remainingTime(task, now)}</span>}
                  {task.duration} min
                </p>
              </div>
              <div className="task-row-end">
                <span className={`status-chip is-${task.status}`}>
                  {task.escalation > 0 && (
                    <span className="escalation-dots" aria-label={`Escalation level ${task.escalation}`}>
                      <span className="escalation-dot" aria-hidden="true" />
                      {task.escalation > 1 && <span className="escalation-dot" aria-hidden="true" />}
                      {task.escalation > 2 && <span className="escalation-dot" aria-hidden="true" />}
                    </span>
                  )}
                  {task.status}
                </span>
                <div className="task-actions">
                  <button
                    type="button"
                    aria-label={`Mark ${task.taskName} done`}
                    className="task-action-button"
                    onClick={() => onTaskAction(task.taskId, 'done')}
                  >
                    <Check size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Discard ${task.taskName}`}
                    className="task-action-button"
                    onClick={() => onTaskAction(task.taskId, 'discard')}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </>
  )
}
