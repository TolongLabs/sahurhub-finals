# SahurHub — Product Requirements Document (PRD)

> Defines **what** we build and **for whom**. The technical **how** lives in [trd.md](trd.md).
> Rules source of truth: [project-requirements.md](project-requirements.md) (extracted 2026-07-15 from the official rules site).

---

## Contents

1. [Vision & Concept](#1-vision--concept)
2. [Hard Constraints from the Rules](#2-hard-constraints-from-the-rules)
3. [Target "Users" & Absurdity Premise](#3-target-users--absurdity-premise)
4. [Scope](#4-scope)
5. [Functional Requirements (MoSCoW)](#5-functional-requirements-moscow)
6. [The Poster (the actual prelim deliverable)](#6-the-poster-the-actual-prelim-deliverable)
7. [Judging Alignment](#7-judging-alignment)

---

## 1. Vision & Concept

**SahurHub** is a real-time, always-on-display **desktop IoT companion** — an animated 3D character living on a palm-sized device screen, converse-able in **both voice and text**.

Its core role is a **personal task-reminder assistant** whose agent **auto-captures tasks from conversational context** — there is no explicit "add task" command; the assistant listens to how you talk and quietly extracts what needs remembering. On a clean conversation history, its opening question gauges your TODO intent, so the very first turn is already doing the job.

The soul of the product is a **sincerity inversion**: functionally reliable, emotionally unhinged. The **deterministic core never drops a task or mistimes a follow-up** — reminders fire on schedule, task facts stay accurate, nothing gets forgotten — while the **character's delivery is completely deranged**. This is a **split-brain principle**, stated explicitly: the engine is the straight man, the character is the bit, and the bit must never break the tool. Reliability and absurdity live in the same product without compromising each other.

The first character is **Sahur**, a wooden log-creature whose personality is **escalating percussion menace** plus **proud confident wrongness** — entirely in how it talks; the task facts it captures and reminds you of are always accurate, no matter how deranged the delivery gets.

**One-liner:** a task reminder that works perfectly, and behaves completely unhinged about it.

## 2. Hard Constraints from the Rules

These are non-negotiable; violating any is ineligibility or disqualification.

- **Prelim deliverable is a poster, not code.** One square **1080×1080 PNG/JPG**, submitted by **19 July 2026, 23:59 MYT** at the submission portal. Late = ineligible. One submission per team.
- **Poster must:** include the **unaltered Qwen logo/wordmark** (white-on-dark or colored-on-light official versions), **name the specific Qwen model** used, and communicate the concept + its uselessness.
- **Qwen integration must be real:** a Qwen model (text/vision/audio/code) demonstrably and functionally integrated — vague "AI-powered" claims are insufficient. Access via Qwen Cloud or ModelScope; **no API credits supplied for prelims** (we bring our own).
- **Voting** (community, Google Form) runs 14 July 21:00 → 19 July 23:59 MYT and determines the shortlist.
- **Finals (25 July, physical):** shortlisted teams **rebuild on-site within 2 hours** — no pre-built work, hardware assembled on-site. Attendance required to win.
- **Content rules:** no NSFW, political/hate content, copyright violations, dangerous instructions, malware, fraud, misleading info, or venue hazards.

## 3. Target "Users" & Absurdity Premise

SahurHub is for people whose tasks pass quietly without anyone menacing them about them. Nobody asked for a task reminder to be percussively confrontational about a duration-driven follow-up — that is precisely the premise, committed to without irony.

The character system's universal law: **every character has a few screws loose, because why not.** Sahur is the first proof of that law, not an exception to it — any future character joining the roster inherits the same rule.

## 4. Scope

### 4.1 Prelim scope (by 19 July)

- A working prototype that proves the Qwen integration claim (feeds the poster's claims + demo material for voting/finals).
- **The poster itself** — see §6.

### 4.2 Finals scope (25 July, 2-hour on-site rebuild)

The MVP cut, re-buildable from scratch in the 2-hour window:

- Voice conversation with the character.
- Automatic task capture from that conversation.
- Duration-driven, escalating reminders on schedule.
- **Sahur** rendered as an animated 3D character with lip-synced speech.

### 4.3 Out of Scope

- **Being useful.** SahurHub is deliberately useless by design — usefulness is never a goal or a metric.
- **Long-term personality memory.** The character does not build a persistent relationship model of the user across sessions.
- **Physical buttons.** Interaction stays voice- and text-driven; no dedicated hardware controls.
- **A second character built.** The character **system** (selectable personas, voices, model sets) is in scope as architecture — a seam for future characters — but only **Sahur** is fully realized this iteration.

## 5. Functional Requirements (MoSCoW)

| Priority   | Requirement                                                                                                          | Notes                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Must**   | Voice-and-text conversation with the character persona                                                               | Powered centrally by the Qwen3.6-Flash chained trio: Qwen3-ASR-Flash → Qwen3.6-Flash → Qwen3-TTS-Flash |
| **Must**   | Automatic task capture — task = exactly `task_id` / `task_name` / `duration`; `duration` drives real-time follow-ups | No explicit "add task" command                                                                         |
| **Must**   | Cold-start TODO-intent opener — on a clean history, the opening question gauges the user's TODO intent               | —                                                                                                      |
| **Must**   | Escalating, character-oriented reminders (gentle → direct → unhinged)                                                | Sincerity inversion: delivery escalates, task facts stay accurate                                      |
| **Must**   | Unprompted initiative on schedule — the assistant reaches out proactively, not only when spoken to                   | —                                                                                                      |
| **Must**   | Conversation-history persistence                                                                                     | —                                                                                                      |
| **Must**   | One character (**Sahur**) fully realized, with a distinct stock TTS voice                                            | Rubric: Integration 20/100                                                                             |
| **Should** | Character selection UI (the character system is built; only Sahur ships)                                             | —                                                                                                      |
| **Should** | Respect Meter                                                                                                        | —                                                                                                      |
| **Should** | Camera misidentification                                                                                             | —                                                                                                      |
| **Could**  | Additional brainrot characters, each with its own model set and personality                                          | Built atop the character-system seam                                                                   |
| **Could**  | Custom TTS voice per character (voice-design / cloning), behind the existing per-character voice seam                | —                                                                                                      |
| **Could**  | Brainrot-intensity dial                                                                                              | —                                                                                                      |
| **Won't**  | Any guarantee of actual usefulness                                                                                   | Deliberately useless by design                                                                         |
| **Won't**  | Long-term memory                                                                                                     | —                                                                                                      |
| **Won't**  | Physical buttons                                                                                                     | —                                                                                                      |
| **Won't**  | Manglish or any specific language mandate                                                                            | Each character speaks in its own brainrot voice, no forced language                                    |

## 6. The Poster (the actual prelim deliverable)

- 1080×1080 px, PNG or JPG, square.
- Produced externally as a 1080×1080 design that names **"Qwen3.6-Flash"** and shows the **unaltered official Qwen logo**.
- Unaltered Qwen logo (pick the version matching the background).
- Sells the concept + its uselessness at a glance — this is what gets voted on.
- A manual pre-submission compliance check verifies the exact dimensions, verbatim model name, unaltered logo, and content rules.
- **Deadline discipline:** submitted before **19 July 2026, 23:59 MYT** per §2 — no exceptions.

## 7. Judging Alignment

| Finals Criterion           | Weight | Our Angle                                                                                                                         |
| -------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Creativity & Originality   | 50     | The sincerity-inversion premise (flawless engine, deranged character) plus the character system                                   |
| Presentation & Showmanship | 30     | An unprompted, mid-demo escalation beat and live character interaction                                                            |
| Qwen Integration Depth     | 20     | The Qwen3-ASR-Flash → Qwen3.6-Flash → Qwen3-TTS-Flash chain is the entire brain — it hears, reasons, classifies, acts, and speaks |

Tiebreakers cascade in that order — when in doubt, spend effort on absurdity first.

---

**Content-rule self-check (§5, `project-requirements.md`):** no NSFW, political/hate, copyright-infringing, dangerous, malicious, fraudulent, misleading, or venue-hazardous content anywhere above. Sahur's roasts stay PG and never target political, ethnic, or religious lines; the escalating-menace bit is affectionate homage, never mockery of the sahur practice. Rendering above stays in product terms ("animated 3D character") with no engine internals named.
