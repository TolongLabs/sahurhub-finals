import { useEffect, useState } from 'react'
import { useTtsPlayer } from './audio/useTtsPlayer.ts'
import CharacterPickerDialog from './components/CharacterPickerDialog.tsx'
import ChatInputBar from './components/ChatInputBar.tsx'
import ChatThread from './components/ChatThread.tsx'
import SettingsPage from './components/SettingsPage.tsx'
import Sidebar from './components/Sidebar.tsx'
import TasksDrawer from './components/TasksDrawer.tsx'
import Topbar from './components/Topbar.tsx'
import { useRemoteConnection } from './hooks/useRemoteConnection.ts'
import { useTheme } from './hooks/useTheme.ts'
import { uploadFile } from './lib/upload.ts'
import { chatActions, useChatStore } from './store/chatStore.ts'

export default function App() {
  const connection = useRemoteConnection()
  const connectionState = useChatStore((s) => s.connection)
  const status = useChatStore((s) => s.status)
  const recording = useChatStore((s) => s.recording)
  const messages = useChatStore((s) => s.messages)
  const tasks = useChatStore((s) => s.tasks)
  const title = useChatStore((s) => s.title)
  const conversations = useChatStore((s) => s.conversations)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const activeCharacterId = useChatStore((s) => s.activeCharacterId)
  const characters = useChatStore((s) => s.characters)
  const audioOutput = useChatStore((s) => s.audioOutput)
  const audioSinkActive = useChatStore((s) => s.audioSinkActive)
  const displayRotation = useChatStore((s) => s.displayRotation)
  const [tasksOpen, setTasksOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [characterPickerOpen, setCharacterPickerOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const { preference: themePreference, setPreference: setThemePreference } = useTheme()

  const player = useTtsPlayer(connection.socket)
  const characterName = characters.find((character) => character.id === activeCharacterId)?.displayName ?? 'Sahur'

  useEffect(() => {
    player.setMuted(!audioSinkActive)
  }, [audioSinkActive, player])

  function handleAudioOutputChange(output: 'phone' | 'device') {
    chatActions.setAudioOutput(output)
    connection.selectAudioSink(output)
  }

  async function handleUpload(file: File, text: string) {
    await uploadFile(file, text)
  }

  return (
    <div className="app-shell">
      <Topbar
        title={title}
        connection={connectionState}
        taskCount={tasks.length}
        onTitleChange={connection.sendTitleEdit}
        onPoke={connection.sendPoke}
        onOpenSidebar={() => setSidebarOpen(true)}
        onOpenTasks={() => setTasksOpen(true)}
      />
      {player.soundLocked && audioSinkActive && <output className="sound-hint">Tap anywhere to enable sound</output>}
      {settingsOpen ? (
        <SettingsPage
          audioOutput={audioOutput}
          onAudioOutputChange={handleAudioOutputChange}
          displayRotation={displayRotation}
          onDisplayRotationChange={connection.selectDisplayRotation}
          themePreference={themePreference}
          onThemeChange={setThemePreference}
          onReset={connection.sendReset}
          onClose={() => setSettingsOpen(false)}
        />
      ) : (
        <>
          <ChatThread messages={messages} status={status} characterName={characterName} onStarter={setDraft} />
          <ChatInputBar
            status={status}
            characterName={characterName}
            recording={recording}
            text={draft}
            onTextChange={setDraft}
            onSendText={connection.sendText}
            onBeginRecording={connection.beginRecording}
            onCommitRecording={connection.commitRecording}
            onFrame={connection.sendAudioFrame}
            onEndRecording={connection.endRecording}
            onInterrupt={connection.sendInterrupt}
            onUpload={handleUpload}
          />
        </>
      )}
      <TasksDrawer
        open={tasksOpen}
        tasks={tasks}
        onClose={() => setTasksOpen(false)}
        onTaskAction={connection.sendTaskAction}
      />
      <Sidebar
        open={sidebarOpen}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onClose={() => setSidebarOpen(false)}
        onCreate={() => {
          setSidebarOpen(false)
          setCharacterPickerOpen(true)
        }}
        onSwitch={connection.switchConversation}
        onDelete={connection.deleteConversation}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <CharacterPickerDialog
        open={characterPickerOpen}
        characters={characters}
        onSelect={(characterId) => {
          connection.createConversation(characterId)
          setCharacterPickerOpen(false)
        }}
        onClose={() => setCharacterPickerOpen(false)}
      />
    </div>
  )
}
