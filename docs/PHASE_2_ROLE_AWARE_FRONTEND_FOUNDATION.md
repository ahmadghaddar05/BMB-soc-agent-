# Phase 2 — Role-aware frontend foundation

## Purpose

This phase introduces the shared frontend structure required for the executive, SOC analyst, and security administrator experiences. It does not invent missing metrics, create fake administration data, or alter the existing backend contracts.

## Implemented

- Normalized frontend roles: `executive`, `soc_analyst`, and `administrator`.
- Distinct default landing pages and navigation for each role.
- Presentation-level route guards that redirect users to their role landing page.
- A development-only role preview selector for reviewing each experience.
- One persistent, context-aware AI Analyst launcher with page-specific suggested prompts.
- Text-selection questions continue to use the same assistant and conversation surface.
- A compact Data Trust banner sourced from the existing dependency-health endpoint.
- Shared semantic status and design tokens for later page redesigns.
- Dark mode is the default while the existing light theme remains available.
- Dependency-health polling pauses when the browser tab is hidden.

## Security boundary

The role preview changes presentation only. It does not modify the authenticated session or server permissions and is excluded from production builds through `import.meta.env.DEV`.

The backend currently reports existing dashboard, API-key, and development sessions as `administrator`. Production role enforcement therefore requires a later backend addition for user roles and per-route authorization. Frontend route hiding must never be treated as a security boundary.

## Navigation currently exposed

Only working pages are included. Future pages are intentionally not represented by fake or disabled links.

- Executive: Overview, Executive Reports.
- SOC Analyst: Monitoring, Triage, Investigations, Incidents, Cases, Approvals, Safe Response Simulation, Assets, Entity Intelligence, Vulnerabilities.
- Security Administrator: Integrations, Reports, Settings.

Risk & Performance, Collector Health, AI Configuration, Users & Access, Audit & Governance, and Data Retention will be introduced in their designated later phases when their page adapters or backend contracts are ready.

## Preserved contracts

Authentication cookies, CSRF handling, alert and incident APIs, investigations, cases, approvals, simulations, reports, dependency health, settings, and Hermes streaming remain unchanged.
