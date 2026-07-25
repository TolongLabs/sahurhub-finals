# Graph Report - SahurHub (2026-07-24)

## Corpus Check

- 112 files · ~61,792 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary

- 852 nodes · 1766 edges · 39 communities (35 shown, 4 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 28 edges (avg confidence: 0.69)
- Token cost: 0 input · 0 output

## Graph Freshness

- Built from commit: `9fbf3aeb`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)

- Qwen Brainrot Hackathon — Official Rules & Requirements
- SahurHub — Product Requirements Document (PRD)
- SahurHub — Technical Requirements Document (TRD)
- 4. Scope
- prd.md
- Spike: mkcert + getUserMedia Phone-Over-Hotspot
- setup.sh
- index.ts
- protocol.ts
- isClientMessage
- compilerOptions
- poster-shot.ts
- setup.sh
- types.ts
- index.ts
- index.ts
- orchestrator.test.ts
- main.ts
- loader.ts
- compilerOptions
- KioskAudioPlayer
- setup-pi.sh
- Sahur — Character Bible
- isServerMessage
- prd.md
- dev-kiosk.sh
- assets.d.ts
- T4 Spike Notes — Qwen Live Availability + Realtime Promotion Gate
- useTtsPlayer.ts
- isClientMessage
- qwen-probe (T4 spike)
- SerializedEventQueue
- TtsPlayer
- ChatThread.tsx
- index.test.ts
- tags.ts
- MarkdownContent.tsx

## God Nodes (most connected - your core abstractions)

1. `Session` - 22 edges
2. `main()` - 21 edges
3. `AgentKernel` - 20 edges
4. `Orchestrator` - 19 edges
5. `validateCharacterDef()` - 18 edges
6. `VoiceBackend` - 18 edges
7. `CharacterModel` - 17 edges
8. `compilerOptions` - 16 edges
9. `MockVoiceBackend` - 16 edges
10. `insertMessage()` - 15 edges

## Surprising Connections (you probably didn't know these)

- `uploadFile()` --calls--> `fetch()` [INFERRED]
  apps/remote/src/lib/upload.ts → src/kiosk/model/serve.ts
- `transcribe()` --calls--> `fetch()` [INFERRED]
  spikes/qwen-probe/asr-probe.ts → src/kiosk/model/serve.ts
- `oneCall()` --calls--> `fetch()` [INFERRED]
  spikes/qwen-probe/chat-probe.ts → src/kiosk/model/serve.ts
- `nonStreaming()` --calls--> `fetch()` [INFERRED]
  spikes/qwen-probe/omni-http-probe.ts → src/kiosk/model/serve.ts
- `streaming()` --calls--> `fetch()` [INFERRED]
  spikes/qwen-probe/omni-http-probe.ts → src/kiosk/model/serve.ts

## Import Cycles

- None detected.

## Communities (39 total, 4 thin omitted)

### Community 0 - "Qwen Brainrot Hackathon — Official Rules & Requirements"

Cohesion: 0.04
Nodes (45): 1. Vision & Concept, 2. Hard Constraints from the Rules, 3. Target "Users" & Absurdity Premise, 4.1 Prelim scope (by 19 July), 4.2 Finals scope (25 July, 2-hour on-site rebuild), 4.3 Out of Scope, 4. Scope, 5. Functional Requirements (MoSCoW) (+37 more)

### Community 1 - "SahurHub — Product Requirements Document (PRD)"

Cohesion: 0.29
Nodes (7): AudioLevel, calculateAudioLevel(), pickMimeType(), RecorderCallbacks, RecorderController, startLevelMonitor(), startRecording()

### Community 2 - "SahurHub — Technical Requirements Document (TRD)"

Cohesion: 0.27
Nodes (8): getSnapshot(), initialState, Listener, listeners, setState(), subscribe(), upsertMessage(), useChatStore()

### Community 3 - "4. Scope"

Cohesion: 0.10
Nodes (35): basePose, BATON_RAISED, BATON_STRIKE, Canvas, crc32(), CRC_TABLE, drawAngryBrows(), drawCharacter() (+27 more)

### Community 4 - "prd.md"

Cohesion: 0.20
Nodes (12): App(), useTtsPlayer(), SettingsPage(), RemoteConnection, toChatMessage(), useRemoteConnection(), readPreference(), ResolvedTheme (+4 more)

### Community 5 - "Spike: mkcert + getUserMedia Phone-Over-Hotspot"

Cohesion: 0.05
Nodes (39): AgentEventKind, AgentEventMessage, AudioEndMessage, AudioSinkEvent, AudioSinkMessage, AvatarEvent, CameraStubMessage, CharacterActiveEvent (+31 more)

### Community 6 - "setup.sh"

Cohesion: 0.06
Nodes (42): ACTIVE_STATUSES, ConversationRow, countMessages(), createConversation(), deleteConversation(), deleteMessages(), getTask(), insertTask() (+34 more)

### Community 7 - "index.ts"

Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, esModuleInterop, isolatedModules, lib, module, moduleResolution, noEmit (+9 more)

### Community 8 - "protocol.ts"

Cohesion: 0.15
Nodes (8): AudioStartMessage, certFile, keyFile, lanIp, MIME_EXT, PORT, server, WsData

### Community 9 - "isClientMessage"

Cohesion: 0.40
Nodes (5): CLIENT_MESSAGE_TYPES, hasOptionalInputSource(), hasOptionalString(), isClientMessage(), isRecord()

### Community 10 - "compilerOptions"

Cohesion: 0.22
Nodes (8): Files, Manual Verification Checklist (Real Hotspot), Notes For TRD §5 (On-Site Regeneration), Phone Steps (Exact), Run It — Dev Machine First, Run It — Raspberry Pi (Bookworm, arm64), Spike: mkcert + getUserMedia Phone-Over-Hotspot, What This Proves

### Community 14 - "types.ts"

Cohesion: 0.33
Nodes (5): UploadButton(), UploadButtonProps, isAllowedUpload(), uploadFile(), UploadResult

### Community 15 - "index.ts"

Cohesion: 0.08
Nodes (33): AppContext, audioSinkForClient(), isClientActiveAudioSink(), getSetting(), setSetting(), createDiscoveryInfo(), DiscoveryInfo, audioSinkFromSetting() (+25 more)

### Community 16 - "index.ts"

Cohesion: 0.05
Nodes (66): main(), BuiltinAnimation, CharacterModel, EXPRESSION_POSES, ExpressionPose, isBuiltinAnimation(), isExpressionName(), lerp() (+58 more)

### Community 17 - "orchestrator.test.ts"

Cohesion: 0.06
Nodes (31): backend, main(), verifySynthesize(), verifyTranscribe(), fetch(), PORT, AppContextOptions, createAppContext() (+23 more)

### Community 18 - "main.ts"

Cohesion: 0.07
Nodes (30): base64ToBytes(), decodePcm16(), KioskAudioPlayer, KioskAudioPlayerOptions, pcmDurationMs(), actionForAgentEvent(), boundedIntensity(), EXPRESSION_ALIASES (+22 more)

### Community 19 - "loader.ts"

Cohesion: 0.08
Nodes (37): TaskStatePatch, initialKernelState(), KernelStateSnapshot, KernelStatus, DEFAULT_SAHUR_PRESET, loadCharacter(), parseBible(), parseManifest() (+29 more)

### Community 20 - "compilerOptions"

Cohesion: 0.07
Nodes (27): compilerOptions, allowImportingTsExtensions, esModuleInterop, isolatedModules, jsx, lib, module, moduleResolution (+19 more)

### Community 21 - "KioskAudioPlayer"

Cohesion: 0.11
Nodes (27): AsrResponse, main(), originals, OUT_DIR, transcribe(), ChatDelta, main(), oneCall() (+19 more)

### Community 22 - "setup-pi.sh"

Cohesion: 0.29
Nodes (9): action(), apt_package_available(), as_app_user(), ok(), run(), setup-pi.sh script, skip(), usage() (+1 more)

### Community 23 - "Sahur — Character Bible"

Cohesion: 0.29
Nodes (6): Comedy Engine, Do's and Don'ts, Identity, Lore, Sahur — Character Bible, Voice & Speech Patterns

### Community 24 - "isServerMessage"

Cohesion: 0.40
Nodes (3): hasStringType(), isServerMessage(), SERVER_MESSAGE_TYPES

### Community 26 - "prd.md"

Cohesion: 0.60
Nodes (4): remainingTime(), TasksDrawer(), TasksDrawerProps, Task

### Community 30 - "T4 Spike Notes — Qwen Live Availability + Realtime Promotion Gate"

Cohesion: 0.15
Nodes (12): 1. Availability Matrix, 2. Latency Tables, 3. Promotion Gate Verdict (Codex opinion §6 thresholds), 4. Quota / Cost Burned, 5. Gotchas Found, 6. Recommended Primary Path, Leg 2 — Chat (`qwen3.6-flash`, streamed, 10 calls), Leg 3 — TTS (`qwen3-tts-flash`, 3 phrases, ~35–49 chars each) (+4 more)

### Community 31 - "useTtsPlayer.ts"

Cohesion: 0.26
Nodes (9): ConfirmDialog(), ConfirmDialogProps, SettingsPageProps, SidebarProps, ThemePreference, ChatState, AudioOutput, Conversation (+1 more)

### Community 32 - "isClientMessage"

Cohesion: 0.29
Nodes (5): CharacterPickerDialog(), CharacterPickerDialogProps, TopbarProps, Character, ConnectionState

### Community 33 - "qwen-probe (T4 spike)"

Cohesion: 0.40
Nodes (4): Files, Quota discipline, qwen-probe (T4 spike), Running

### Community 35 - "SerializedEventQueue"

Cohesion: 0.44
Nodes (7): ChatInputBar(), ChatInputBarProps, formatElapsed(), RecordButton(), RecordButtonProps, AgentStatus, RecordingState

### Community 38 - "TtsPlayer"

Cohesion: 0.27
Nodes (4): base64ToBytes(), TtsPlayer, TtsPlaybackHandle, chatActions

### Community 39 - "ChatThread.tsx"

Cohesion: 0.32
Nodes (3): ChatThreadProps, STATUS_LABEL, ChatMessage

### Community 40 - "index.test.ts"

Cohesion: 0.08
Nodes (25): getConversation(), insertMessage(), SerializedEventQueue, ALLOWED_TAG_KINDS, extractTags(), KNOWN_EMOTIONS, normalizeTaskName(), ParsedTagEvent (+17 more)

### Community 41 - "tags.ts"

Cohesion: 0.29
Nodes (6): Comedy Engine, Do's and Don'ts, Identity, Lore, Tralala — Character Bible, Voice & Speech Patterns

### Community 43 - "MarkdownContent.tsx"

Cohesion: 0.36
Nodes (5): MarkdownContent(), MarkdownBlock, MarkdownSegment, parseInline(), parseMarkdown()

## Knowledge Gaps

- **239 isolated node(s):** `AudioLevel`, `TtsPlaybackHandle`, `STATUS_LABEL`, `ConfirmDialogProps`, `UploadButtonProps` (+234 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions

_Questions this graph is uniquely positioned to answer:_

- **Why does `fetch()` connect `orchestrator.test.ts` to `index.ts`, `main.ts`, `KioskAudioPlayer`, `types.ts`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **Why does `bun` connect `compilerOptions` to `orchestrator.test.ts`, `main.ts`, `index.ts`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **What connects `AudioLevel`, `TtsPlaybackHandle`, `STATUS_LABEL` to the rest of the system?**
  _239 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Qwen Brainrot Hackathon — Official Rules & Requirements` be split into smaller, more focused modules?**
  _Cohesion score 0.0425531914893617 - nodes in this community are weakly interconnected._
- **Should `4. Scope` be split into smaller, more focused modules?**
  _Cohesion score 0.0990990990990991 - nodes in this community are weakly interconnected._
- **Should `Spike: mkcert + getUserMedia Phone-Over-Hotspot` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `setup.sh` be split into smaller, more focused modules?**
  _Cohesion score 0.05789009697325889 - nodes in this community are weakly interconnected._
