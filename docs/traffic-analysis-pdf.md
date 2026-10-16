# Traffic Analysis PDF export

Use **Export PDF** in Traffic Analysis after a capture has finished indexing. Stop a live capture before exporting. The report uses the capture, filters, time range, time zone, concentration metric and application theme selected when the button is clicked.

The PDF contains:

- Complete capture totals, rates and a vector requests timeline.
- The active filters and selected interval, with separate selected statistics and timeline when applicable.
- Leading destinations, clients, users, methods, statuses, actions, categories, applications, issues and security results.
- Traffic-volume contributors and detailed breakdowns of concentrated traffic intervals.
- Field availability, ingestion diagnostics and source information.

Statistics are calculated from the entire indexed capture or matching selection, independently of the currently displayed record page. Rankings include the top ten entries. Long names are abbreviated after 240 characters. This is an aggregated report, not an export of every raw request or diagnostic.

## Concentrated traffic

Detection uses the active requests/bytes metric within the selected scope. A minute qualifies when it contains at least 5% of the timed metric and at least three times the average of the other observed minutes, including silent gaps. Minimum activity is three requests or 1 KiB. Adjacent qualifying minutes become one interval. Up to three intervals with the highest metric receive detailed breakdowns; the report also states the total number detected.

A single observed minute does not establish a baseline. Records without timestamps remain in aggregate totals but cannot be assigned to a peak. Concentration is descriptive and does not establish an incident or its cause. Contributor shares in a peak section are relative to that peak.

## Rendering and storage

The renderer and locally bundled OFL fonts load only when exporting. Shared application CSS tokens are resolved to the PDF palette at export time, so light and dark reports match the active theme without external font requests. Pages include repeated headers, provenance footers and page numbers.

In Tauri (development and production), the native backend saves `traffic-analysis-<UTC timestamp>-<theme>.pdf` inside `app_cache_dir()/traffic-analysis`, opens it with the default PDF viewer, and displays the saved path with an **Open folder** action. Files are not overwritten; write failures remove partial output. A missing PDF viewer does not discard the saved report. In a regular web browser, export uses a standard download instead. Export does not change Tauri storage paths, modify the original log, or upload data. Changing captures cancels pending output; the capture is checked again after aggregation to reject changing input.

## Validation

- `pnpm exec tsc --noEmit`
- `pnpm exec playwright test --config tests/traffic-report-model.config.ts`
- `pnpm exec playwright test tests/e2e/traffic-report.spec.ts`

Browser tests exercise the real PDF renderer in both themes with standard downloads and simulated native save/open commands. Their text assertions require Poppler's `pdftotext` on PATH. Native Windows download behavior should also be checked in a Windows build.
