# Shared dropdowns (2026-10-20)

## Audit and migration

All 28 native selects across the application now opt into `AppSelect`. No feature select remains unenhanced.

| Location | Controls migrated |
| --- | --- |
| Admin lists/details | 9: status, role, rating, onboarding, entity, sorting/direction, platform role and membership role |
| Campaigns, both routes | 6: status, campaign type, discount type, overlap policy, audience and trigger |
| CRM Contacts drawer | 1: explicit marketing-consent decision |
| Instant Rewards (platform/delegated) | 4: status, type/enabled filters and reward kind |
| Questionnaire builder/onboarding | 1: answer type; existing type-change and dependent-choice handlers retained |
| Responses | 2: rating and contact filters |
| Recovery Rewards | 3 rule controls (including numeric ngValue), 1 incident rule selector |
| Application shell | 1: authorized business switcher; existing business preference/navigation retained |

Additionally, BusinessForm category/timezone suggestions (onboarding, business profile and Admin business editor) use the same renderer while retaining arbitrary custom text. These are deliberately not restricted enums.

Campaign card actions, Admin business-detail actions, Admin row actions and the account/avatar menu share `ActionMenu`. Admin's old fixed-menu coordinates, duplicated keyboard/outside handlers and row-menu state were removed. Permission conditions, tenant IDs, routes, confirmations and API calls remain in their existing feature owners.

Dashboard date pills, Settings appearance cards, public questionnaire radio/checkbox answers, chart table disclosures and collapsed Campaign settings are not dropdown menus and retain their semantics. CampaignPicker's authorized, paginated business/contact search and multi-selection remain intact; replacing it with a client-side list would change loading and security behavior. No new backend endpoints, dependencies or business rules.

## Architecture

- `shared/select-control.ts/html`: OnPush standalone `app-select`, with typed primitive `SelectValue`, `SelectOption`, ControlValueAccessor, single/multiple selection, search, reset, custom-text suggestions, grouped/disabled options, icon/description metadata, loading/empty/errors, keyboard navigation and selected chips/highlights.
- `shared/app-select.ts`: `select[appSelect]` and `input[appSelect][list]` adapters create that same component through ViewContainerRef. Native elements remain form sources, visually hidden and removed from the accessibility/tab sequence. Native Angular value accessors, option encodings (including numeric/object ngValue), reactive/template-driven validators, names, IDs and change/input handlers stay authoritative. UI selection writes the native selected option(s) and dispatches the original event. Labels, help/error associations, required/disabled/invalid states and touched/blur are mirrored. Label activation forwards focus to the visible control.
- Native adapters synchronize after rendering and observe option/label/group mutations; selection-only changes do not rebuild option arrays. Async option-count changes are detected during the render pass. Observers/listeners are cleaned up on destruction.
- `shared/dropdown-panel.ts`: common manual Popover API top layer. It keeps logical DOM ancestry inside existing DialogFocus modals, avoiding a body portal and focus-trap exceptions. Fixed positioning clamps to the visual viewport, measures available space and opens upward when needed. ResizeObserver and captured scroll/visual-viewport listeners reposition outside Angular, throttled by animation frame. Offscreen anchors dismiss. Outside pointer dismissal is shared.
- `shared/action-menu.ts`: OnPush projected button/link menu, using the same panel. Menu/menuitem semantics, active focus, Arrow/Home/End, Escape/Tab, outside dismissal and focus restoration are shared. Disabled actions are skipped. Focus returns to the initiating control before sensitive actions can open their existing confirmations. Custom avatar triggers are projected without duplicating menu logic.
- `src/dropdowns.css`, imported by existing `styles.css`: existing `--surface`, `--surface-soft`, `--ink`, `--line`, `--accent` and error tokens. No parallel palette. 44px select/option touch targets, clear controls, rounded borders, modest shadow, wrapped long option labels, truncated trigger values/chips, dark-mode inheritance and reduced-motion support.

## Component API

`SelectOption`: `{value: string | number | boolean | null, label: string, description?, icon?: IconName, group?, disabled?}`. Values must be unique. Keep grouped options adjacent; supplied ordering is retained.

`app-select` inputs:

- `options: readonly SelectOption[]`
- `multiple`, `searchable`, `clearable`, `allowCustom` (custom text is single selection)
- `value` for controlled usage; `valueChange` output (or use Angular forms/CVA)
- `label`, `labelledBy`, `describedBy`, `placeholder`, `required`, `maxLength`
- `disabled`, `loading`, `invalid`, `error`; `touched` output

Single clear emits null (custom text clears to an empty string); multiple clear emits an empty array. Search alone never changes constrained selections. Custom-text input intentionally updates its form value while typing. Programmatic form reset/disable is supported. Validation subscribes to actual form-control events; errors are associated with their control.

```html
<!-- Existing forms: no value/payload rewrite. Import AppSelect in the owning standalone component. -->
<label for="status">Status</label>
<select appSelect id="status" name="status" [(ngModel)]="status" (change)="apply()">
  <option value="">All</option>
  <option value="active">Active</option>
</select>

<!-- New forms: import SelectControl and ReactiveFormsModule. -->
<app-select label="Customers" formControlName="customers"
  [options]="customerOptions" [multiple]="true" [loading]="loading" />

<!-- Existing editable suggestions preserve custom entries. -->
<input appSelect id="category" list="categories" formControlName="category" />
<datalist id="categories"><option value="Cafe"></option></datalist>

<!-- Actual actions retain button/link handlers and permission conditions. -->
<app-action-menu label="Actions">
  <button type="button" (click)="edit()">Edit</button>
  <button type="button" (click)="requestCancelConfirmation()">Cancel</button>
</app-action-menu>
```

Native adapter inputs: `appSelectLoading`, `appSelectSearchable` (boolean or default `auto`, search appears above seven options), `appSelectPlaceholder`. Native multi-select uses its `multiple` attribute; option metadata uses `data-icon`/`data-description`, and grouping uses optgroup. Native single reset is offered only when an enabled empty option exists; no new null value is silently introduced into existing enum payloads.

Action menu inputs: `label`, optional `ariaLabel`, `iconOnly`, `triggerClass`; `customTrigger` enables projection of an element marked `menuTrigger` for the existing account avatar.

## Performance and browser boundary

Filtering is cached against the option-array reference and query. OnPush and stable option values preserve DOM nodes. The first 80 matching options render, with explicit incremental Show more; search always covers the entire supplied list. This is bounded initial rendering, not full virtual scrolling. Do not fetch an entire tenant/platform dataset just to fill a dropdown: preserve authorized server search/pagination (CampaignPicker) for those resources. Replace option arrays immutably for standalone async options.

Top-layer overlays require the Popover API provided by current Angular-supported browsers. Existing native selects and datalists remain functional without enhancement when that API is absent. There is no third-party dependency or custom portal/focus-trap exception. All menus stay on the existing page.

## Verification

Shared ChromeHeadless regressions exercise numeric native ngValue and multiple CVAs, standalone reactive forms/reset/validation/touched, custom text, search and empty/reset states, metadata/groups/disabled/loading, async options/model updates, exact filter events, 2,000-option search with bounded initial rendering, keyboard selection/Escape/Tab, clipped modal top-layer placement and modal Escape isolation, long labels/viewport edge clamping at 390/768/1280px, and projected action callbacks/disabled navigation. Existing Admin/Campaign tests now use the shared visible action triggers. The Admin row-focus test scrolls/focuses the trigger before opening, matching a real user interaction; offscreen anchors intentionally dismiss.

Auth's storage regression compares storage before/after login instead of assuming unrelated business/theme preferences do not exist; token-storage behavior is unchanged.
