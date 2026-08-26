# Design System

The implemented design system is CSS-first. Its current canonical token block begins at `/* BMB product system */` in `frontend/src/index.css`; `frontend/tailwind.config.js` maps a subset of Tailwind color utilities onto those variables. Earlier legacy variables, later compatibility aliases, Tailwind defaults, and page-specific literal values remain active, so the application is not yet fully tokenized.

## Source of Truth and Cascade

```text
frontend/src/index.css
  early :root light/legacy variables
  [data-theme="dark"] legacy overrides
  page and feature styles
  [data-theme="light"] selector-specific overrides
  later :root "BMB product system" variables  <-- effective canonical tokens
  compatibility aliases
  shared UI and feature styles

frontend/tailwind.config.js
  semantic Tailwind color aliases -> later product variables

frontend/src/styles/mitre-coverage.css
  MITRE-specific layout and motion using the product variables
```

Because the later `:root` block has equal specificity and appears after the early block, it replaces shared names such as `--radius-sm`, `--bg`, `--surface`, and `--text` regardless of `data-theme`. Light mode therefore relies on selector-specific literal overrides rather than a complete light token theme.

## Color Tokens

### Canonical product tokens

| Token name | Implemented value | Usage |
|---|---:|---|
| `--bg-base` | `#0B0F17` | Application canvas and primary-button text. |
| `--bg-surface` | `#12161F` | Cards, panels, and compatibility `--surface`. |
| `--bg-surface-2` | `#171C27` | Raised/muted panels, secondary hover surfaces, inputs. |
| `--border-subtle` | `rgba(255, 255, 255, 0.06)` | Card and low-emphasis separators. |
| `--border-default` | `rgba(255, 255, 255, 0.10)` | Inputs, controls, and selected/raised boundaries. |
| `--accent` | `#3DD6C0` | Primary action, focus outline, live state, chart line, active state. |
| `--accent-dim` | `rgba(61, 214, 192, 0.12)` | Accent background and focus ring. |
| `--severity-critical` | `#E5484D` | Critical alert and error state. |
| `--severity-high` | `#F5A623` | High-severity and attention state. |
| `--severity-medium` | `#E9C46A` | Medium-severity state. |
| `--severity-low` | `#7C8798` | Low or fallback severity state. |
| `--text-primary` | `#F2F4F7` | Headings and primary content. |
| `--text-secondary` | `#8A93A6` | Supporting labels and descriptions. |
| `--text-tertiary` | `#565E6E` | Low-emphasis metadata and empty-state decoration. |
| `--success` | `#34D399` | Resolved, successful, or verified state. |
| `--warning` | `#F5A623` | Degraded and attention state. |

### Compatibility mappings

| Legacy/semantic token | Effective product token |
|---|---|
| `--bg`, `--color-bg-canvas` | `--bg-base` |
| `--bg-soft`, `--surface`, `--color-bg-subtle`, `--color-panel` | `--bg-surface` |
| `--surface-2`, `--surface-3`, `--color-panel-raised`, `--color-panel-muted` | `--bg-surface-2` |
| `--border`, `--color-border` | `--border-default` |
| `--border-soft`, `--color-border-subtle` | `--border-subtle` |
| `--text`, `--color-text-primary` | `--text-primary` |
| `--muted`, `--color-text-secondary` | `--text-secondary` |
| `--muted-2`, `--color-text-muted` | `--text-tertiary` |
| `--blue`, `--color-accent` | `--accent` |
| `--green`, `--color-success` | `--success` |
| `--red`, `--color-critical` | `--severity-critical` |
| `--orange` | `--severity-high` |
| `--yellow`, `--color-attention` | `--severity-medium` / `--warning` |

`--purple` and `--color-ai` are inherited from the early token block (`#8a6cff` through `--purple`) because the product block does not replace them. Login, legacy shell, administrative, and executive styles also contain many literal blue, navy, white, and shadow values.

## Typography

The font stack is:

```css
Inter, "IBM Plex Sans", ui-sans-serif, system-ui, -apple-system,
BlinkMacSystemFont, "Segoe UI", sans-serif
```

Neither Inter nor IBM Plex Sans is imported or bundled in this repository. Unless installed on the client device, the UI uses the platform system font.

### Product scale

| Size | Weight | Implemented usage context |
|---:|---:|---|
| `28px` | `700` | KPI values and MITRE coverage counts. |
| `20px` (`text-xl`) | `700` | Legacy `.page-title`. |
| `18px` | `600–750` | Selected modal, login, and feature headings. |
| `16px` | `600` | Shared card headings and section headings. |
| `14px` | `500` | Body text and form controls. |
| `14px` | `600` | Shared buttons and selected controls. |
| `13px` | `500–600` | Card descriptions, timeline details, status labels. |
| `12px` | `400–600` | KPI labels, badges, metadata, table annotations. |
| `10–11px` | `600–800` | Legacy uppercase eyebrows and dense admin metadata. |
| `7–9px` | `500–700` | Security Analytics dense chart/rank labels; this is page-specific, not a shared token. |

Body defaults are `14px`, weight `500`, and line-height `1.5`. Numeric table cells and KPI values use `font-variant-numeric: tabular-nums`. The repository does not define named font-size or font-weight CSS variables, so the table is an implementation inventory rather than an enforceable token scale.

## Spacing Scale

The early root block defines six reusable spacing variables; the later product block does not replace them.

| Token | Value | Pixels at a 16px root | Observed usage |
|---|---:|---:|---|
| `--space-1` | `0.25rem` | `4px` | Small inline gaps. |
| `--space-2` | `0.5rem` | `8px` | Badges and compact control gaps. |
| `--space-3` | `0.75rem` | `12px` | Row/control spacing. |
| `--space-4` | `1rem` | `16px` | Standard control padding and layout gap. |
| `--space-5` | `1.25rem` | `20px` | Compact card padding and timeline spacing. |
| `--space-6` | `1.5rem` | `24px` | Default card and page-region padding. |

Shared product components mostly follow `4/8/12/16/20/24px`, but values are written directly rather than through the tokens. Page styles also use `6`, `7`, `9`, `10`, `13`, `14`, `18`, `22`, `30`, and `32px`; Tailwind utilities introduce its standard spacing scale. There is no single enforced spacing API.

## Radius and Elevation

### Radius

| Token/rule | Value | Usage |
|---|---:|---|
| `--radius-sm` | `6px` | Buttons, badges, chips, compact rows. |
| `--radius-md` | `10px` | Cards, inputs, standard panels. |
| `--radius-lg` | `14px` | Larger panels where explicitly used. |
| Circular | `50%` | Status dots, avatars, radial controls. |
| Pill | `999px` | Selection assistant and selected legacy pills. |

Legacy and page-specific rules use radii from `3px` through `18px`; connector dialogs use `16px`. These values are not represented by product tokens.

### Elevation

| Rule | Value | Usage |
|---|---|---|
| `--modal-shadow` | `0 8px 24px rgba(0, 0, 0, 0.4)` | Product modal elevation where referenced. |
| `--shadow` | Early light: `0 16px 40px rgba(36, 75, 107, .10)`; dark override: `0 16px 42px rgba(0, 0, 0, .24)` | Legacy cards and workflow sections. |
| Shared `.ui-card` | No box shadow | Separation is border plus surface color. |
| Connector modal | `0 24px 80px rgba(0,0,0,.45)` | Page-specific high overlay. |
| Login card | `0 28px 80px rgba(0,0,0,.48)` | Page-specific high elevation. |

There is no multi-level semantic elevation scale. Overlays and older panels use literal shadows.

## Motion and Animation

The product easing token is `cubic-bezier(0.16, 1, 0.3, 1)`. The early legacy transition token remains `150ms ease`, and a number of older rules use `ease`, `ease-out`, or `ease-in-out` directly.

| Animation/transition | Implemented timing and easing | Location/trigger | Reduced-motion handling |
|---|---|---|---|
| Product panel/page enter | `180ms var(--motion-ease)`; timeline/recommendation stagger `80ms` per item | Shared cards, pages, timeline, simulator/replay panels | Disabled by relevant media queries. |
| KPI count-up | `300ms`, cubic ease-out computed in JavaScript | First numeric render in `KpiTile` | **Not disabled.** See drift log and [KI-009](KNOWN_ISSUES.md#ki-009-count-up-animation-ignores-reduced-motion). |
| Shared chart draw | `600ms var(--motion-ease)` | `.ui-chart-line` | Disabled. |
| MITRE attack-path draw | `600ms var(--motion-ease)` with `40ms` path-order delay | Incident path SVG | Disabled. |
| Confidence gauge draw | `500ms var(--motion-ease)` | Stored confidence change | Disabled. |
| Product live pulse | `1.8s ease-in-out infinite` | Live indicators/status orbit | Disabled. |
| Skeleton shimmer | `1.5s linear infinite` | Shared skeleton | Disabled. |
| Dashboard legacy shimmer | `1.3s infinite` (default easing) | Legacy dashboard loader | No adjacent reduced-motion override was found. |
| Auth spinner | `1s linear infinite` | Initial session load | No adjacent reduced-motion override was found. |
| Small loading spinners | `600ms` or `800ms linear infinite` | Buttons, triage, incident, monitoring | Product/page instances are generally disabled; coverage is selector-specific. |
| Selection assistant enter | `140ms ease-out` | Text selection popup | No reduced-motion override found. |
| Digital-twin edge flow | `1.2s linear infinite` | Active edge traversal | Disabled. |
| Digital-twin/MITRE node pulse | `1.4s ease-in-out infinite` | Targeted, compromised, processing nodes | Disabled for listed selectors. |
| Alert replay operation/model motion | `1.2s` flow; `1.4s` pulse/scan; `180ms` fact enter | Replay scene | Disabled by replay reduced-motion rules. |
| Shared button feedback | color/filter/background `120ms`, transform `100ms`, product easing | Hover/press | No explicit shared-button reduced-motion rule. |
| MITRE selection/background | `400ms var(--motion-ease)`; hover transform `120ms` | Timeline/heatmap | Disabled. |

## Responsive Rules

The implementation uses component-specific media queries rather than named breakpoint tokens. Common breakpoints are approximately `1100px`, `900px`, `760/767px`, and `560px`. Tailwind’s default breakpoints are also available. Layout behavior must therefore be verified per page; there is no project-defined breakpoint contract.

## Accessibility Styling

All focusable elements matched by the global selector receive a `2px` accent outline, `2px` offset, and a `3px` accent-dim ring. Several login controls define their own blue focus treatment. CSS reduced-motion blocks cover the shared product system, simulator, replay, Digital Twin, monitoring, analytics, and MITRE animations, but do not cover every legacy animation or the JavaScript KPI count-up.

## Drift Log

No standalone original design brief is present in the repository, so exact design-intent comparisons cannot be independently verified. The following drift is observable between the repository’s earlier token layer, its later labeled product system, and current component code.

| Area | Intended/current reference | Implemented drift | Decision required |
|---|---|---|---|
| Theme cascade | App exposes dark/light selection; early tokens define both schemes. | The later unscoped product `:root` forces dark semantic tokens. Light mode is a long list of selector-specific literal overrides and does not cover all newer shared components. | Define complete `[data-theme]` token sets or remove the light-mode control. |
| Accent | Early system uses blue `#176fca`; product system defines teal `#3DD6C0`. | Legacy/login/admin selectors still use multiple blues while shared product components use teal. | Choose role/page exceptions explicitly or migrate literals. |
| Font delivery | Stack names Inter and IBM Plex Sans. | Neither font is imported or bundled, so rendering depends on the device. | Bundle the approved font or document system-font rendering as intentional. |
| Spacing | Six spacing tokens exist. | Most new components repeat literal pixel values; legacy pages use additional increments. | Replace repeated values with an agreed semantic spacing scale. |
| Radius | Product system defines `6/10/14px`. | Existing rules use `3–18px` and pills, including `16px` connector modals and `18px` login cards. | Normalize or document component exceptions. |
| Elevation | Product system provides one modal shadow. | Multiple literal card/modal shadows coexist, while shared product cards use no shadow. | Create explicit surface/elevation levels. |
| Motion easing | Product system specifies `cubic-bezier(0.16, 1, 0.3, 1)`. | Legacy rules and live/pulse motion use `ease`, `ease-out`, or `ease-in-out`; this is visible but may be appropriate for continuous motion. | Restrict the product easing to entrances/interactions and document continuous-motion easing. |
| Reduced motion | Multiple CSS media queries disable product motion. | JavaScript count-up, auth spinner, legacy dashboard shimmer, and selection-assistant entrance are not comprehensively covered. | Add a shared reduced-motion hook and consolidate selectors. |
| Typography | Shared components cluster around `12/13/14/16/28px`. | Dense analytics text drops to `7–9px`, and legacy page headings vary up to `54px` on login. | Establish minimum readable sizes and formal page-heading/display roles. |
| Token coverage | Tailwind maps semantic product colors. | Many components still use literal hex values or legacy utility names; color changes require edits across CSS. | Complete token migration and add visual-regression coverage. |

---

Last updated: 2026-08-26 — generated by CSS cascade, Tailwind configuration, shared-component, and motion implementation audit
