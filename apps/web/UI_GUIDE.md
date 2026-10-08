# Web UI guide (for contributors)

The app is React 19 + Vite + Tailwind v4 + Recharts. All numbers come from `@aies/engine` (`computeProject`). **Never do financial arithmetic in the UI** — read it from the `ProjectResult`, or call an engine function. Formatting only (`lib/format.ts`).

## Structure
- `src/state/store.tsx` — app state. Use these hooks:
  - `useCurrentProject()` → the project selected in the top bar (all module pages work on it).
  - `useResult(project)` → memoised `ProjectResult` (cheap to call repeatedly).
  - `useProjectUpdater(project.id)` → `update('Audit message', draft => { draft.x = y })`. The draft is a deep copy; the change is audited and persisted. Call it from `onChange` handlers.
  - `useCatalogUpdater()` → same for the catalogue (rate cards, FX, ACU weights, cloud prices).
  - `useCan('pricing.edit')` → role permission (from `@aies/engine` rbac). When false, render inputs `disabled` and show `<ReadOnlyNote show />`.
  - `useStore()` → `{ state, dispatch }` for anything else (projects list, templates, audit log, role).
- `src/components/ui.tsx` — primitives: `PageHeader`, `Panel`, `SectionTitle`, `StatStrip`, `KeyValues`, `Badge`, `IssueList`, `Callout`, `Empty`, `Tabs`, `Segmented`, `Field`, `NumberInput` (commits on blur/Enter/700 ms pause), `TextInput`, `TextArea`, `Select`, `Toggle`, `Checkbox`, `Modal`, `ReadOnlyNote`, `Hint`, `Button`, `cx`.
- `src/components/charts.tsx` — `ChartFrame` (title, legend, Table toggle — always pass `table`), `StackedBars`, `Lines`, `Waterfall`, `Tornado`, `BarList`, `CompositionBar`, `SimpleBars`, `POOL_COLOR`, `SERIES`, `useColors`.
- `src/lib/format.ts` — `money`, `unitPrice`, `compact` (₹15.1 L / ₹2.19 Cr), `pct`, `signedPct`, `num`, `count`, `tokens`, `months`, `periodLabel`, `n()` (Decimal → number).
- `src/lib/slice.ts` — period/workflow/agent slicing helpers and `modelName`, `agentName`, `workflowName`.
- `src/lib/router.ts` — hash router: `href(route, ...params)`, `navigate()`.
- Reference implementation: `src/pages/Dashboard.tsx` and `src/pages/dashboard/*`. Match its look and patterns.

## Visual rules
- Palette: white paper, charcoal ink, ledger green brand. Use token classes only: `bg-paper`, `bg-canvas`, `bg-sunken`, `text-ink`, `text-ink-2`, `text-ink-3`, `border-line`, `border-line-soft`, `bg-brand`, `text-brand`, `bg-brand-tint`, `text-good|warn|bad`, `bg-good-tint|warn-tint|bad-tint`. No raw hex in components (dark mode swaps the tokens).
- Type: Source Sans 3 for UI; Source Serif 4 (`font-serif`) only for page titles (via `PageHeader`) and at most one hero statement per page. Sentence case everywhere. No ALL-CAPS labels, no eyebrow labels, no "→" in buttons, no middle-dot meta strings.
- Layout: page = `PageHeader` → content. Group related inputs in `Panel`s; put figures in one `StatStrip` (not rows of separate cards). Two-column layouts use `grid gap-5 xl:grid-cols-2` (or `xl:grid-cols-[1.2fr_1fr]`); everything must work at 375 px width.
- Tables: `<div className="scroll-x"><table className="dtable min-w-[…px]">`; numeric columns get `className="r"` on both `th` and `td`; inputs inside tables use the same `NumberInput` etc.
- Numbers: currency through `compact()` in summaries, `money()` in detail tables, `unitPrice()` for unit prices. Percentages `pct()`.
- Charts: always via `ChartFrame` with a `table` prop (accessibility). Cost pools always use `POOL_COLOR[pool]` (colour follows the entity). Single-series charts use `--accent-series`. One y-axis only.
- Copy: plain verbs, say what an action does ("Add workflow", "Save rate card version"). Errors say what is wrong and how to fix it. Empty states invite action.
- Motion: none beyond state changes.
- Mark illustrative/sample data clearly where rates are shown ("sample rate").

## Behaviour rules
- Inputs edit the current project immediately via `useProjectUpdater`; the engine recomputes and every page/dashboard/report updates.
- Show engine `issues` relevant to the page (`result.issues`, filter by `code`) with `IssueList`.
- Respect RBAC: disable editing when `useCan(...)` is false.
- Heavy computations (sensitivity, many scenario runs) run in `useMemo` keyed on inputs, or behind a button; never inside render loops per keystroke.
- Keep components in the page file or `src/pages/<page>/*.tsx`; do not modify shared files without need (if you must, keep changes backwards-compatible).
