# Medallia Survey Component

This repository provides a clean, vendor-agnostic implementation for managing and displaying Medallia surveys.

## Files

- `SurveyEngine.js`  
  Headless decision engine responsible for:
  sampling, quarantine, priority handling, and survey selection.
  It contains no DOM, page logic, or vendor-specific UI code.

- `InvitationRenderer.js`  
  UI layer responsible for:
  loading Medallia (Kampyle), rendering invitation templates,
  handling accept/decline actions, and triggering Medallia events.

- `UsageExample.js`  
  Example controller showing how to wire the engine and the renderer together.
  Page matching and candidate selection logic live here.

## Architecture principles

- Page-to-survey matching is intentionally external.
- Survey selection (decision) is separated from rendering (presentation).
- No dependency on Tealium data layer (`b`) or global state.
- Events and logging are exposed via callbacks.

## Usage notes

- `SurveyEngine.js` and `InvitationRenderer.js` must be loaded before `UsageExample.js`.
- Suitable for plain browser usage, Tealium extensions, or bundlers.
- The example file is illustrative and not required in production.
