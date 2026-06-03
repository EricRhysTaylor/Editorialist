# Community Review and Web Radial Timeline Plan

## Summary

The proposed community review system is the first web-native slice of Radial
Timeline, not just an Editorialist add-on. Obsidian Radial Timeline remains the
authoring source at first. The website becomes the collaboration and review
surface. Editorialist remains the revision execution layer inside Obsidian.

The core path is:

```text
RT scene snapshot
  -> website review workspace
  -> contributor voice/text review packet
  -> LLM-assisted canonical batch conversion
  -> Editorialist import/review/apply flow
```

The system should avoid building adapters for Word, Google Docs, PDF comments,
and other external formats. Those workflows remain supported through
LLM-assisted conversion into Editorialist's canonical review batch format. The
best user experience comes from the RT + website + Editorialist combination,
because it preserves scene IDs, scene order, and review anchors from the start.

## Product Positioning

Radial Timeline's differentiation is not generic manuscript comments. It is
story structure as an interface. Community review should lean on the radial
scene layout as the core product identity:

- Authors release scenes through a timeline snapshot.
- Contributors read with story position and scene context.
- Locked or unreleased scenes can remain visible as gray timeline placeholders.
- Voice notes and selected-text notes attach to a scene-aware story map.
- Editorialist receives feedback with stable scene IDs preserved.
- Professional editors can work against arcs, scenes, pacing, reveals, and
  revision passes instead of a flat document only.

The strategic product split is:

```text
Radial Timeline = structured manuscript map
Website = permissioned reader/editor workspace
Editorialist = revision execution layer
```

## Findings From Current Editorialist

Editorialist already has the hard local review machinery:

- Contributors are modeled as human or AI reviewers with aliases, reviewer
  types, strengths, and stats.
- Review batches already support scene grouping, accept/reject/defer/rewrite,
  guided sweeps, and recent-review history.
- `ImportEngine.inspectBatch()` is the canonical intake gate for raw review
  batch text.
- The review template already emits scene ID context for LLM conversion.
- The durable plugin data stores decision/status metadata, not full historical
  suggestion prose. Imported review blocks currently hold the full audit surface
  until cleanup.

The main current gaps are:

- No `EXPAND` operation.
- No local onboarding surface for outside feedback conversion.
- No local review-packet artifact.
- No website inbox integration.
- No AI API conversion path inside Editorialist.
- No remote scene snapshot or collaborator permission model yet.

## Core Principles

1. Preserve `sceneId` everywhere.
2. Treat website review output as structured review packets, not as direct
   manuscript edits.
3. Do not build custom adapters for every foreign document tool.
4. Keep all manuscript changes author-controlled inside Editorialist.
5. Use explicit user actions for network requests from Obsidian.
6. Make voice and selection low-friction for contributors.
7. Keep the web platform editor-agnostic so it can grow beyond Obsidian later.
8. Build one shared data backbone, then vary features by tier.

## Canonical Operation Vocabulary

Editorialist should add `EXPAND` before the community review system hardens.
This keeps the review vocabulary stable before website packets and voice notes
start producing structured review items.

Recommended operation set:

- `EDIT`: replace wording with supplied revision text.
- `CUT`: remove a passage.
- `CONDENSE`: compress or tighten a passage.
- `EXPAND`: decompress, develop, or slow down a passage.
- `MOVE`: relocate a passage or beat.
- `MEMO`: commentary that is not directly actionable as one operation.

`EXPAND` should mirror `CONDENSE`:

```text
=== EXPAND ===
SceneId: scn_xxxxxxxx
Target: "She looked away and said nothing."
Suggestion: Slow this beat down with more internal reaction before she answers.
Why: The emotional turn feels summarized.
```

Two modes are useful:

- Advisory expand: no replacement prose required.
- Direct expand: supplied expanded prose can replace the target passage.

Line edits can still absorb expansion when the reviewer or LLM provides exact
replacement wording. `EXPAND` exists for clearer classification, voice-review
conversion, and analytics.

### Backward Compatibility

Adding `EXPAND` changes the review block grammar. The parser must continue to
accept existing review blocks that do not contain `EXPAND`. Old blocks parse
unchanged; `EXPAND` is purely additive to the keyword set and the operation
union.

## Website Review Concept

The website should not expose an author's live vault. It should expose a
versioned, permissioned, read-only Timeline Review Snapshot.

An author creates a snapshot containing:

- project/book ID
- snapshot ID and version
- scene order
- stable scene IDs
- scene display titles, optionally masked as `Scene 1`, `Scene 2`, etc.
- released scene text
- locked scene placeholders
- scene text hashes
- line/paragraph maps
- contributor access rules
- optional author guidance for the review pass

Contributors see only released scenes. Locked scenes may appear as gray,
unclickable timeline nodes so the reader understands story structure without
receiving hidden content.

### Manual Snapshot Upload (MVP)

For the first version, the snapshot moves from Obsidian to the website as a
manual file upload performed by the author. Radial Timeline exports the
`TimelineSnapshot` to a local file; the author uploads it through the website.

This keeps the Radial Timeline plugin network-free and consistent with the
explicit-user-action philosophy. In-plugin upload (an HTTP POST from Obsidian)
is deferred to a later phase and is never automatic background sync.

## Contributor Review Modes

The best experience supports several low-friction review modes:

- Voice only: contributor reads and speaks natural feedback.
- Select + voice: contributor selects a sentence or passage and records a note.
- Line/paragraph + voice: contributor clicks a line or paragraph and records.
- Scene-level reflection: contributor records broad feedback after reading.
- Typed note: fallback for contributors who prefer writing.
- Formal line edit: optional for paid editors or copy editors.

The system should not require casual contributors to type exact wording or
perform formal annotation. Most community feedback is anchored reaction, not
polished replacement prose.

## Audio Privacy Model

The recommended promise is contributor-owned audio:

- Audio notes belong to the contributor.
- The author receives processed outputs by default: transcript, summary,
  anchored notes, and review packets.
- The contributor controls whether original audio is retained, deleted, or
  shared.
- If a future "audio never leaves device" mode is desired, transcription must
  happen locally or on-device.

This avoids promising that audio is never transferred when cloud transcription
may be used.

### Consent and Retention

Before voice review ships (Phase 5), define:

- Contributor consent at recording time, stating where audio is processed and
  how long it is retained.
- Retention and deletion controls for both audio and transcripts.
- Data residency expectations, since voice recordings and transcripts from EU
  contributors are likely personal data under GDPR.

These must be settled before the first voice note is captured, not after.

## Shared Data Contracts

These contracts should be defined before major website implementation begins.

### TimelineSnapshot

```json
{
  "projectId": "proj_123",
  "snapshotId": "snap_123",
  "snapshotVersion": 1,
  "createdAt": "2026-06-03T00:00:00.000Z",
  "sceneOrder": ["scn_001", "scn_002"],
  "scenes": [
    {
      "sceneId": "scn_001",
      "displayTitle": "Scene 1",
      "actualTitle": "Optional private title",
      "isReleased": true,
      "textHash": "sha256...",
      "revision": 3,
      "lineMap": [
        { "line": 1, "startOffset": 0, "endOffset": 82 }
      ],
      "paragraphMap": [
        { "paragraph": 1, "startOffset": 0, "endOffset": 220 }
      ]
    }
  ]
}
```

### ScenePermission

```json
{
  "snapshotId": "snap_123",
  "contributorId": "user_456",
  "sceneId": "scn_001",
  "canRead": true,
  "canComment": true,
  "canSeeActualTitle": false
}
```

### ReviewPacket

```json
{
  "packetId": "rp_123",
  "projectId": "proj_123",
  "snapshotId": "snap_123",
  "sceneId": "scn_001",
  "sceneRevision": 3,
  "snapshotVersion": 1,
  "sceneTextHash": "sha256...",
  "contributor": {
    "id": "user_456",
    "displayName": "Maya",
    "reviewerType": "beta-reader"
  },
  "items": [
    {
      "itemId": "ri_001",
      "kind": "voice-note",
      "transcript": "This reveal should come later, maybe after her husband leaves.",
      "summary": "Move the clue reveal later in the scene.",
      "anchor": {
        "selectedText": "the clue about the camellia",
        "prefix": "nearby text before",
        "suffix": "nearby text after"
      },
      "displayHint": {
        "lineStart": 30,
        "lineEnd": 31,
        "paragraph": 4
      },
      "operationHint": "MOVE",
      "confidence": "medium"
    }
  ]
}
```

Anchoring rules for every review item:

- The durable anchor is `sceneId` + `anchor.selectedText` + `anchor.prefix` /
  `anchor.suffix`, qualified by `snapshotVersion` and `sceneTextHash`.
- `displayHint.lineStart` / `lineEnd` / `paragraph` are non-authoritative. They
  help a reader locate context and must never be used as the primary match key.
- `anchor.selectedText` must be copied verbatim from the snapshot scene text so
  Editorialist's matcher can resolve it against the manuscript. It is never
  paraphrased.
- This mirrors how Editorialist already matches: verbatim target text and
  prefix/suffix style anchor fragments, not line references.

### EditorialistInboxItem

```json
{
  "inboxItemId": "inbox_123",
  "packetId": "rp_123",
  "projectId": "proj_123",
  "snapshotId": "snap_123",
  "contributorName": "Maya",
  "sceneId": "scn_001",
  "sceneLabel": "Scene 1",
  "status": "ready",
  "createdAt": "2026-06-03T00:00:00.000Z",
  "packetDownloadUrl": "https://..."
}
```

### CanonicalBatch

This is the existing Editorialist `editorialist-review` text block. It remains
the author-facing import format until in-app AI conversion can produce batches
directly.

## Snapshot Drift Reconciliation

A review packet is created against a specific snapshot. By the time it returns to
Obsidian, the local vault scene may have advanced. Editorialist must not trust a
stale packet blindly.

Rule:

- Each packet carries `sceneId`, `sceneRevision`, `snapshotVersion`, and
  `sceneTextHash`.
- On import, Editorialist compares the packet's `sceneRevision` / `sceneTextHash`
  against the current local scene.
- If they match, items resolve normally through `ImportEngine.inspectBatch()`.
- If they differ, every item from that scene is routed through the existing
  verification path and surfaced as `unresolved` (reusing the current
  `MatchType` `none` / `already_applied` states). The author confirms each match
  manually. Nothing auto-applies against a drifted scene.
- Anchor resolution still attempts a verbatim `selectedText` + prefix/suffix
  match, so many items re-anchor cleanly even after drift; only ambiguous or
  missing matches require author attention.

This keeps scene ID drift a handled state rather than a silent corruption risk.

## Backend Architecture

Framer can remain the public website and gated-content shell, but it should not
be the source of truth for review data.

Recommended stack:

- Framer: marketing site, documentation, videos, file links, lightweight public
  and gated pages.
- Lemon Squeezy: subscriptions, license keys, customer portal, billing webhooks,
  and entitlement state.
- Supabase: project data, snapshots, scene permissions, review packets,
  transcript records, storage, and server-side functions.
- Clerk or Supabase Auth: website identity and profile sessions.

Recommended default identity stack:

- Start with Supabase Auth + Supabase DB + Lemon Squeezy. One platform for auth,
  database, storage, and edge functions keeps the vendor count low, and Postgres
  row-level security gives permissioned snapshot viewing (the `ScenePermission`
  contract) almost for free.
- Add Clerk later only if login/profile UX becomes a product differentiator or
  Supabase Auth feels limiting. This is a default, not a permanent decision.

Lemon Squeezy should handle payment and entitlement, not contributor identity or
review data. Subscription cancellation should preserve access through the paid
period and expire access when the subscription/license actually expires.

## APR/Social Reuse

Do not let the current APR/social feature define the manuscript and review
architecture unless it already has the required primitives.

Safe reuse areas:

- profile ideas
- trusted relationship concepts
- social graph patterns
- contributor/community language
- high-level feed or notification concepts

Core records should be purpose-built:

- `TimelineSnapshot`
- `SceneSnapshot`
- `ScenePermission`
- `ContributorGroup`
- `ReviewPacket`
- `EditorialistInboxItem`
- `Entitlement`

The website-native RT review platform should become the shared collaboration
surface. Obsidian plugins are clients of that platform, not the platform itself.

## Editorialist Integration

Editorialist should remain local-first and author-controlled.

Immediate network rules:

- No background polling.
- No hidden sync.
- Community inbox refresh is an explicit user action.
- License refresh is an explicit user action.
- AI conversion is an explicit user action.
- Use Obsidian `requestUrl()` for HTTP calls that may need CORS handling.

Side-panel future flow:

1. Author clicks `Refresh community inbox`.
2. Review cards appear for available packets.
3. Author opens a card.
4. Editorialist saves the packet into the vault.
5. Author copies packet plus conversion prompt to an external LLM, or later uses
   in-app AI conversion.
6. The converted canonical batch runs through `ImportEngine.inspectBatch()`.
7. Existing review UI handles verification, mismatches, accept/reject/defer, and
   cleanup.

## Open Intake For Other Tools

Word, Google Docs, PDF comments, email, and other feedback sources should be
supported through guided conversion rather than native adapters.

Editorialist should provide:

- side-panel onboarding placard for outside feedback
- copyable conversion prompt
- canonical batch template
- instructions to preserve reviewer names and scene IDs when available
- instructions to omit uncertain scene IDs instead of inventing them
- paste/import path using the current batch importer

This keeps the plugin deterministic and avoids adapter maintenance.

## AI Conversion Privacy

There is no AI network path today, so no manuscript or review text leaves the
device. This section is a forward commitment for when in-app AI conversion
(Phase 7) ships.

When direct AI conversion is added:

- It is opt-in and off by default.
- The workflow makes the AI step obvious and states, in clear language, that the
  text is being sent to an AI provider, naming the provider and model.
- A single confirm-and-send button press is sufficient. Per-request approval is
  not required once the feature is enabled.
- This preserves Editorialist's "no hidden network requests" promise without
  adding friction to every conversion.

## Product Tiers

### Free / Casual

- public website content
- free files/videos
- basic review templates
- limited snapshot demos or examples
- no heavy collaboration tooling

### Community Feedback

- author snapshots
- released scenes only
- masked locked scenes
- trusted contributor groups
- website reader mode
- voice notes
- transcript and summary
- anchored notes
- author inbox
- Editorialist import workflow
- barter/reciprocal feedback as a social pattern, not payments at first

### Industry Pro

- full manuscript snapshots
- professional editor workspace
- manuscript version history
- line-edit mode
- developmental memo mode
- richer editorial control
- stronger permissions and audit trails
- editorial reports
- subscription entitlement through Lemon Squeezy

Marketplace payments, tips, and payouts to third-party editors should wait.
They introduce tax, dispute, fraud, identity verification, moderation, and
support obligations.

## Proposed Deployment Schedule

### Phase 0: Contract and Vocabulary

Owner: Editorialist + RT planning.

Deliverables:

- Add `EXPAND` to the planned canonical operation set.
- Finalize `TimelineSnapshot` and `ReviewPacket` draft schemas.
- Decide durable anchor fields: `sceneId`, selected text, prefix/suffix,
  paragraph/line index, text hash, snapshot version.
- Confirm default auth stack: Supabase Auth + Supabase DB (add Clerk only later
  if needed).
- Decide Lemon Squeezy entitlement shape.

Exit criteria:

- Stable operation vocabulary.
- Shared schemas accepted for RT, website, and Editorialist.

### Phase 1: Editorialist Local Preparation

Owner: Editorialist.

Deliverables:

- Implement `EXPAND`.
- Update parser, grammar, template text, toolbar icon, review panel rendering,
  matching/apply behavior, and tests.
- Add outside-feedback onboarding placard.
- Add copyable LLM conversion prompt.
- Optionally add a local review-packet markdown/JSON save flow.

Website dependency: none.

Exit criteria:

- Existing paste batch process accepts `EXPAND`.
- Authors can convert outside feedback through an LLM without new adapters.

### Phase 2: RT Snapshot Export

Owner: Radial Timeline.

Deliverables:

- Export `TimelineSnapshot`.
- Include stable scene IDs, scene order, text hashes, revision markers, line
  maps, paragraph maps, and release flags.
- Add feedback-requested scene metadata.
- Add local preview or export validation.

Website dependency: none.

Exit criteria:

- A snapshot can be generated locally and validated against the shared schema.

### Phase 3: Website Foundation

Owner: website/backend.

Deliverables:

- Keep Framer for public/gated website shell.
- Add backend project store.
- Add user auth.
- Add Lemon Squeezy webhook ingestion and entitlement records.
- Add author project area.
- Add snapshot upload/publish.
- Add contributor groups and scene permissions.

Editorialist dependency: none beyond shared schemas.

Exit criteria:

- An author can publish a snapshot and release selected scenes to selected
  contributors.

### Phase 4: Website Reader MVP

Owner: website/backend.

Deliverables:

- Timeline/list reader for released scenes.
- Gray locked-scene placeholders.
- Generic title masking.
- Scene text display with line or paragraph anchors.
- Text selection note capture.
- Typed notes.

Exit criteria:

- A contributor can read released scenes and create structured review items with
  scene IDs preserved.

### Phase 5: Voice Review MVP

Owner: website/backend.

Deliverables:

- Record voice note for selected text.
- Record voice note for clicked line/paragraph.
- Record scene-level voice reflection.
- Transcribe audio.
- Summarize transcript.
- Generate operation hints including `EXPAND`.
- Store contributor-owned audio policy and retention controls.

Exit criteria:

- A contributor can submit processed transcript/summary/anchored notes without
  giving the author the raw audio by default.

### Phase 6: Editorialist Community Inbox

Owner: Editorialist + backend.

Deliverables:

- Add explicit `Refresh community inbox`.
- Display review cards in the side panel.
- Download/save review packet to vault.
- Copy review packet plus conversion prompt.
- Later: one-click AI conversion once API support exists.

Exit criteria:

- Author can pull website packets into Obsidian and run the current canonical
  batch workflow.

### Phase 7: AI API Conversion

Owner: Editorialist.

Deliverables:

- Provider/API key settings.
- Explicit `Convert packet with AI` action.
- Prompt assembly from review packet plus current template.
- Preview canonical batch.
- Run `inspectBatch()`.
- No direct apply without existing verification.

Exit criteria:

- Author no longer needs to leave Obsidian for the LLM conversion step.

### Phase 8: Industry Pro Layer

Owner: website/backend + Editorialist + RT.

Deliverables:

- Full manuscript snapshots.
- Professional editor workspace.
- Stronger permissions.
- Version history and audit trails.
- Line-edit and developmental modes.
- Exportable editorial reports.
- Pro entitlement tiers.

Exit criteria:

- The platform supports paid professional editing workflows without forcing the
  same UX as casual community feedback.

### Phase 9: Full Web RT Path

Owner: website/backend + RT.

Deliverables:

- Project dashboards.
- Scene metadata editing.
- Timeline editing.
- Revision tracking.
- Manuscript import/export.
- Gradual migration from read-only snapshot collaboration toward full web
  authoring.

Exit criteria:

- Web RT is a first-class application rather than only a review companion.

## What Can Be Done Now

Editorialist:

- Add `EXPAND`.
- Add outside-feedback onboarding.
- Improve canonical conversion prompts.
- Add local review-packet artifact support.
- Prepare side-panel space for future community inbox cards.

Radial Timeline:

- Define snapshot export.
- Add feedback-requested scene metadata.
- Add line/paragraph maps and scene text hashes.
- Add masked scene title support.

Website:

- Choose backend/auth stack.
- Define entitlement model with Lemon Squeezy.
- Build snapshot upload/publish foundation after schemas settle.

## What Must Wait For Website

- Contributor login and trusted groups.
- Permissioned snapshot viewing.
- Voice recording and transcription.
- Contributor-owned audio controls.
- Author community inbox feed.
- Review packet generation from actual website reader sessions.
- Professional editor workspace.
- Full web RT evolution.

## Key Risks

- Scene ID drift if snapshots and local vault revisions are not versioned.
- Overpromising audio privacy before transcription architecture is chosen.
- Building marketplace payments before basic trusted collaboration works.
- Letting gated-content tooling define application data architecture.
- Treating line numbers as durable anchors instead of display aids.
- Adding AI conversion before packet schemas are stable.
- Building a generic document-comment product instead of preserving RT's story
  structure identity.

## Recommended Next Actions

1. Implement `EXPAND` in Editorialist.
2. Draft and validate `TimelineSnapshot` in Radial Timeline.
3. Draft and validate `ReviewPacket`.
4. Add outside-feedback onboarding to Editorialist.
5. Confirm Supabase Auth + Supabase DB as the default stack; revisit Clerk later.
6. Wire Lemon Squeezy only as billing/entitlement.
7. Build website snapshot reader MVP.
8. Add voice notes after scene-aware reading works.
