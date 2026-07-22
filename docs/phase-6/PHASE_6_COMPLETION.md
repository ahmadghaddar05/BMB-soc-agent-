# Phase 6 Completion Report

## What changed

Phase 6 makes the two core analyst workflows durable and collaborative:

- Added PostgreSQL investigations, investigation-to-alert evidence links, investigation notes, incident case owners, and case notes.
- Added authenticated APIs to list, create, read, update, and delete investigations and to add investigation notes.
- Added authenticated APIs to list and read cases, update case owner/status, and append case notes.
- Added an audit event for every workflow mutation with actor, request ID, target, and changed-field metadata.
- Added bounded, read-only Hermes tools for listing and reading durable investigations and cases.
- Replaced Investigations-page `localStorage` records with server persistence.
- Replaced Cases-page browser-local owners and notes with server persistence and append-only timelines.
- Preserved source alerts when investigations are removed.

## Why

Browser-local workflow state disappeared when storage was cleared, could not be shared between browsers, and had no trustworthy author or audit history. Server-owned records make investigations and cases consistent with the rest of the SOC data model and provide reliable context for later AI and approval phases.

## API surface

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/investigations` | List durable investigations |
| `POST` | `/api/investigations` | Create an investigation from validated alert evidence |
| `GET` | `/api/investigations/:id` | Read an investigation and its notes |
| `PATCH` | `/api/investigations/:id` | Update owner, status, or title |
| `DELETE` | `/api/investigations/:id` | Delete the workspace, links, and notes only |
| `POST` | `/api/investigations/:id/notes` | Append an investigation note |
| `GET` | `/api/cases` | List incident-backed cases |
| `GET` | `/api/cases/:id` | Read one case and its notes |
| `PATCH` | `/api/cases/:id` | Update case owner or status |
| `POST` | `/api/cases/:id/notes` | Append a case note |

## Deliberately deferred

- Automatic or manual containment integrations.
- Approval execution and external write actions.
- Durable playbook definitions/runs and watchlists.
- Multi-role RBAC beyond the existing authenticated administrator model.
- AI-authored workflow mutations.

These remain later phases so this phase can establish a small, reliable server workflow boundary first.
