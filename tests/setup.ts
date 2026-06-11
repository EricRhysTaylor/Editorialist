// Vitest runs in a plain node environment, but production code uses
// window-scoped timers (window.setTimeout etc.) for Obsidian popout-window
// compatibility. Alias window to globalThis so those calls work under test.
(globalThis as { window?: unknown }).window ??= globalThis;

export {};
