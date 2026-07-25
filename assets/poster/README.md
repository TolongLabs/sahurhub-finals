# Poster Assets

Logo assets + the poster hard-requirements contract. Read before building `poster.html`/`poster.css` (T14) and before the compliance gate (T15). Source of truth for these requirements: `docs/project-requirements.md` §3.

## Logo Assets

| File                                   | Variant           | Use on            | Source                                                                               |
| -------------------------------------- | ----------------- | ----------------- | ------------------------------------------------------------------------------------ |
| `assets/poster/logo/logo-white.png`    | White wordmark    | Dark backgrounds  | <https://drive.google.com/file/d/1BX3WvH9TRl5LTKimrTpZBtt8z4qEEhXM/view?usp=sharing> |
| `assets/poster/logo/logo-coloured.png` | Coloured wordmark | Light backgrounds | <https://drive.google.com/file/d/1cGzEdLcoa_oO02VCSker8o10DARVvWvW/view?usp=sharing> |

Both are **4713×1586 PNG, unaltered**, downloaded directly from the official Drive links via `https://drive.google.com/uc?export=download&id=<FILEID>`. The white variant is pure-white RGB with a transparent alpha channel (renders blank on a white preview background — this is expected; it is designed to sit on dark art).

**Rule (hard):** the logo must **not be altered, obscured, or restyled** — no recolouring, no cropping into the wordmark, no filters. Place one of the two variants as-is, matched to the poster background.

## Poster Hard Requirements (§3 — Compliance Gate)

Every box must be checked before submission (T15). Any failure below **disqualifies the entry from shortlisting**, regardless of votes.

- [ ] **Format:** exactly **1080×1080 pixels**, square (1:1), **PNG or JPG**
- [ ] **Logo:** the official Qwen logo/wordmark appears **visibly and legibly**, **unaltered** (use `logo-white.png` or `logo-coloured.png` as-is, correct variant for the background)
- [ ] **Model named:** the poster states a **specific Qwen model** verbatim (per `docs/decisions.md` — poster name policy: **Qwen3.5-Omni**, unless both Omni endpoints fail the T4 spike, in which case revisit)
- [ ] **Deadline:** submitted at the portal (<https://submit-qbh.damnitjoshua.workers.dev/>) **before 19 July 2026, 23:59 MYT** — late posters are not shortlisted
- [ ] **One submission** per team — do not resubmit casually; replace, don't duplicate
- [ ] **Content Rules (§5) clean:** no NSFW, politics/hate, copyright theft, weapons/explosives, controlled substances, self-harm/violence, malware, fraud, dangerous misinformation — original/parody-safe character, never the Noxa/T3 likeness, affectionate (not mocking) sahur reference

This checklist is the T14/T15 contract: T14 builds to it, T15 gates on it before submitting.
