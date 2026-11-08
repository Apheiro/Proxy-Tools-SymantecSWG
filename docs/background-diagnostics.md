# Background diagnostics

Active Connections collectors are owned by the backend and indexed by proxy origin
and data profile. Opening a workspace attaches to its existing collector. Navigating
to a different proxy does not stop collection. Pause, Resume, Refresh and Stop affect
only the matching scope and capture. Changing data profile stops incompatible work.

Continuous polling uses the stored interval value `0` as a mode sentinel. It waits
350 ms after processing and committing a sample before fetching again. XML is
transient; SQLite stores processed snapshot data. Network errors retain retry
backoff, and authentication failures require explicit Resume. Cancellation joins any
already-started XML parse before another fetch can begin.

The live summary and chart continue updating while the inspection table remains on
a pinned snapshot. **Inspect latest sample** updates that inspection deliberately.
Paging, filters, expanded sessions and details therefore stay consistent while new
samples arrive. Chart zoom uses time bounds and pins the displayed timeline so its samples do not
fall out of the rolling window. Inspecting the latest sample resumes the live timeline.

Traffic Analysis and Comparative Reports are owned by `DiagnosticsHost` in the root
layout. Visited workspaces remain mounted and hidden when navigating away, keeping
stream listeners, file processing, report queries and their controls alive. Separate
proxy workspaces can run concurrently. They are discarded on a data-profile change;
existing cancellation and profile isolation still apply. This is app-session
persistence, not job recovery after closing or restarting the application. Saved
SQLite captures continue to use the existing proxy/profile libraries.

The bottom-left task dock lists executing work only, including connection retry
backoff with its explicit status. Paused, stopped, completed and failed work has no
indicator. Its entries contain proxy identity, route and status only. Active
Connections uses the sanitized `ac_list_running` inventory; Traffic Analysis and
Comparative Reports report execution state from their retained workspaces. A dock
status-read failure clears stale indicators and displays an availability message.
