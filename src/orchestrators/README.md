# orchestrators/

Host-injected coordinators that own multi-step workflows extracted from
`main.ts`. Each class accepts a narrow `*Host` interface at construction
time, holds no Obsidian dependency directly (beyond `Notice` for user
messages where needed), and is independently unit-tested.

This folder originally split into `controllers/` and `orchestrators/` to
reflect *extraction order* rather than architectural role. Pass 21 merged
them; every file here sits at the same layer (between core/state/services
and the UI/main composition root). The class-name suffixes are
*role-distinguishing* labels, not directory categories:

| Suffix         | Role                                                  | Example |
| ---            | ---                                                   | --- |
| `*Orchestrator` | Drives a multi-step workflow on top of services       | `SessionOrchestrator`, `ReviewActionsOrchestrator` |
| `*Coordinator`  | Long-lived subsystem owner with internal state        | `PendingEditsCoordinator` |
| `*Processor`    | Stateless batch transformation                        | `ReviewBatchProcessor` |
| `*Controller`   | UI lifecycle owner (positioning, visibility, cleanup) | `ToolbarOverlayController` |

When extracting more behavior from `main.ts`, place it here and pick the
suffix that matches the role. Add the corresponding `*Host` interface
inline at the top of the new file.
