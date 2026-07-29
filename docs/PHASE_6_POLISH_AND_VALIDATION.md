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
