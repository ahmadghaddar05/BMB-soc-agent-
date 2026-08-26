# Phase 6 — Interface Polish and Workflow Clarity

Phase 6 is the final usability and consistency pass for the explainable analyst workflow.

## What changed

- Replaced fragile background-position logo cropping with dedicated transparent BMB logo assets.
- Applied the updated identity to the login page, application sidebar, collapsed navigation, browser title, and favicon.
- Removed the extra page scrollbar around the desktop triage workspace while preserving independent table and evidence-pane scrolling.
- Kept table headings visible during long alert reviews and added clearer keyboard focus.
- Moved AI evidence limitations directly into the decision explanation instead of separating them from the verdict.
- Added a truthful current-state fallback for alerts already linked to incidents when older append-only correlation events do not exist.
- Updated incident correlation views to distinguish:
  - recorded correlation provenance;
  - current stored incident membership;
  - genuinely missing correlation information.
- Tightened spacing, scrollbars, focus states, cards, and responsive login behavior.

## Correlation honesty

Phase 6 does not fabricate historical AI decisions.

When append-only correlation events exist, the interface displays the recorded executor, model, confidence, reason, and per-alert outcome. When an older alert is currently linked to an incident but its historical ledger event is unavailable, the interface labels this as **Current state** or **Membership recorded**. It does not claim that the missing AI reasoning was recovered.

## AI limitations

Known model limitations now appear directly below the decision facts. This keeps the assessment, confidence, citations, and missing evidence in one review area. An absent limitation is also described honestly: it means the model supplied no explicit limitation, not that the evidence is complete.

## Backend compatibility

No existing endpoint was removed or renamed. The alert journey response gained one additive field:

```json
{
  "current_state": {
    "incident": null,
    "description": "..."
  }
}
```

Existing clients can ignore this field. New clients use it only to explain current incident membership.

## Correlation backlog repair

The triage worker can complete up to 50 alerts in one cycle, so correlation now accepts up to 50 newly triaged alerts per cycle as well. A migration repositions the BMB correlation cursor at the earliest triaged alert from the last seven days that has no recorded correlation outcome. This safely replays recent BMB workflow decisions without changing or deleting Elastic data.

The Incident Command queue now separates two measurements:

- **Incident records**: independent security stories currently stored as incidents.
- **Correlated alert membership**: alerts attached to the loaded incident records.

The first number does not increase when new activity is merged into an existing incident. The second does. The queue refreshes every 30 seconds while the browser tab is visible so analysts can observe both changes without reloading the page.

Source detection titles are also explicitly distinguished from BMB correlation. A title such as “Multiple Alerts for Same User” describes the Elastic rule that created the alert; it does not mean the BMB correlation worker has recorded a result.
