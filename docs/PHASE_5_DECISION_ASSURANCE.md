# Phase 5 — Decision Assurance

Phase 5 turns the append-only analyst reviews from Phase 4 into a compact quality-control view for SOC analysts.

## Purpose

The view answers four operational questions:

1. How many AI-assisted triage and incident decisions were completed?
2. How many received a human review?
3. How often did the latest human review confirm the decision?
4. Which decisions were challenged or need more evidence?

The interface deliberately calls this **analyst agreement**, not AI accuracy. Agreement is useful quality evidence, but it is not independently verified ground truth.

## Analyst experience

Technical Triage now contains a small **Decision assurance** control. It shows the current review-coverage percentage without adding another permanent dashboard panel.

Opening it displays:

- completed machine decisions;
- human-review coverage;
- analyst agreement among reviewed decisions;
- challenged and evidence-deficient decisions;
- separate alert-triage and incident-decision coverage;
- review activity over time; and
- recent append-only reviews with links back to the affected alert or incident.

The panel supports 7-, 30-, and 90-day windows.

## Calculation boundary

The denominator contains unique decisions completed inside the selected period:

- completed alert `triaged` stages executed by AI or a validated cache; and
- completed incident `incident_decision` stages executed by AI.

For each entity, only its latest analyst review recorded inside the period determines its current reviewed state.

Review coverage is:

```text
reviewed in-scope decisions / completed in-scope machine decisions
```

Analyst agreement is:

```text
confirmed reviews / all reviewed in-scope decisions
```

If a denominator is zero, the corresponding percentage is unavailable rather than invented.

## API

`GET /api/workflow-quality?days=30`

Access is restricted to SOC analysts and administrators. Executive users do not receive this technical quality-control endpoint.

The response includes the calculation methodology so the UI cannot present the result as model accuracy.

## Safety

Phase 5 is read-only. It does not train a model, change a verdict, create or close an incident, or execute a response action.
