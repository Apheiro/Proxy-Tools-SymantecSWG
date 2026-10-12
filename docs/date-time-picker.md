# Shared date and time picker

`src/components/ui/date-time-picker.tsx` is the shared composition of Kalyx
(`@kalyx/react` 1.4.7). It uses the existing semantic Tailwind theme tokens for
inputs, calendar days, selections, focus, popovers and errors. The popup uses the shared Radix Popover wrapper in `src/components/ui/popover.tsx`.
Radix portals the content outside the timeline ScrollArea, anchors it to the
trigger, handles viewport collisions and limits height through its available-height
CSS variable. Kalyx manages date/time selection within that content.

```tsx
<DateTimePicker
  label="Through (UTC, inclusive)"
  value={dateTimeToISO(draftEnd, 'UTC')}
  onChange={(iso) => setDraftEnd(isoToDateTime(iso, 'UTC', 'second'))}
  timeZone="UTC"
  precision="second"
/>
```

Values and callbacks use ISO UTC instants or `null` for an empty bound. The
helpers in `src/lib/dateTime.ts` adapt the existing civil strings:

- Trace keeps local browser time, minute precision, quick ranges and paired-bound validation.
- Traffic Analysis keeps UTC, second precision, inclusive end bounds, presets and Apply range. The chart display timezone remains independent.

Kalyx defaults to UTC, so local controls explicitly receive the browser's IANA
timezone. ISO-valued consumers can also pass any supported IANA `timeZone`.
Civil-text editing supports local time and UTC; other zones use Kalyx's calendar
and time controls.

Customization is centralized through `className`, `triggerClassName`,
`inputClassName`, `labelClassName`, `calendarProps.classNames`, `popoverProps`
and `timeClassNames`. `popoverProps` forwards Radix content options, including
side, alignment, offsets, collisions and focus/dismissal callbacks. Kalyx root options expose locale, direction, week start,
minute step, hour format, disabled dates, time constraints, read-only state and
accessibility labels. `precision` enables seconds; `clearable`, `placeholder`,
`error`, `id` and `name` support form use cases. Free-form editing is hidden when
date/time constraints are configured, so it cannot bypass Kalyx validation.

The text editor accepts civil date/time strings, validates calendar dates, and
commits on blur or Enter. Clearing emits `null`. Kalyx handles calendar navigation and time selection. Radix handles popup opening,
Escape, outside interaction, focus restoration and positioning. No custom portal
or client-mount flag is required. Application filters
still use their existing Apply actions.

Verification commands:

```sh
node --experimental-strip-types --test src/lib/dateTime.test.mjs src/lib/trafficAnalysis.test.mjs
TZ=America/Argentina/Salta node --experimental-strip-types --test src/lib/dateTime.test.mjs
pnpm exec tsc --noEmit
pnpm run build
```

Tests cover UTC seconds, local minute round-trips, empty/invalid values, leap
dates and IANA display. SSR checks cover the shared trigger, seconds, ISO hidden
fields, clearing and disabled fields. Interactive visual verification requires
a browser; none was connected in the development session.

[Kalyx documentation](https://kalyx-docs-site.vercel.app/docs/components/datetimepicker)
