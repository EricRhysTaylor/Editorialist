// Owns the floating review-toolbar overlay: lifecycle, scroll/resize
// re-positioning (rAF-deduped), visibility rules, dismissal-signature
// gating, and teardown. Extracted verbatim from EditorialistPlugin
// (main.ts) — behavior is byte-identical; main.ts is now only the
// composition root that instantiates this controller and delegates.
//
// The controller deliberately knows nothing about the plugin: it reaches
// the three values it cannot own (the active highlight range, the selected
// suggestion id, and how to build the toolbar element) through the narrow
// ToolbarOverlayHost it is constructed with.

import type { EditorView } from "@codemirror/view";
import type { ToolbarState } from "../ui/Toolbar";

export interface OverlayRange {
	start: number;
	end: number;
}

export interface ToolbarOverlayHost {
	// Live read each reposition — the highlight range moves as the user
	// navigates suggestions.
	getActiveHighlightRange(): OverlayRange | null;
	// Used to build the dismissal signature (mode + selection).
	getSelectedSuggestionId(): string | null;
	// Builds the toolbar DOM for a given state (wires action callbacks).
	createToolbarElement(state: ToolbarState): HTMLElement;
}

export class ToolbarOverlayController {
	private el: HTMLElement | null = null;
	private editorView: EditorView | null = null;
	private frameId: number | null = null;
	private height = 0;
	private lastPosition: { hidden: boolean; left: string; top: string } | null = null;
	private state: ToolbarState | null = null;
	private dismissedSignature: string | null = null;

	private readonly scrollHandler = (): void => {
		this.scheduleRepositionInternal();
	};

	constructor(private readonly host: ToolbarOverlayHost) {}

	sync(
		editorView: EditorView | null,
		toolbarState: ToolbarState | null,
		highlight: OverlayRange | null,
	): void {
		const isHandoff = toolbarState?.mode === "handoff";
		const isPanel = toolbarState?.mode === "panel";
		const isPendingEdits = toolbarState?.mode === "pending_edits_review";
		const hasHighlight = Boolean(highlight && highlight.end > highlight.start);
		if (!editorView || !toolbarState || (!isHandoff && !isPanel && !isPendingEdits && !hasHighlight)) {
			this.destroy();
			return;
		}

		if (this.dismissedSignature !== null) {
			const currentSignature = this.computeDismissalSignature(toolbarState);
			if (currentSignature === this.dismissedSignature) {
				this.destroy();
				return;
			}
			this.dismissedSignature = null;
		}

		if (this.editorView !== editorView) {
			if (this.editorView) {
				this.editorView.scrollDOM.removeEventListener("scroll", this.scrollHandler);
			}

			this.editorView = editorView;
			this.editorView.scrollDOM.addEventListener("scroll", this.scrollHandler, {
				passive: true,
			});
		}

		if (this.el) {
			this.el.remove();
		}

		this.state = toolbarState;
		this.el = this.host.createToolbarElement(toolbarState);
		this.el.ownerDocument.body.appendChild(this.el);
		this.measureHeight();
		this.lastPosition = null;
		this.scheduleRepositionInternal();
	}

	// Terminal/audit toolbar exit: freeze the current mode+selection so the
	// overlay does not immediately rebuild on the next sync for the same
	// state, then tear down.
	dismiss(): void {
		this.dismissedSignature = this.computeDismissalSignature(this.state);
		this.destroy();
	}

	clearDismissedSignature(): void {
		this.dismissedSignature = null;
	}

	handleResize(): void {
		this.measureHeight();
		this.scheduleRepositionInternal();
	}

	scheduleReposition(): void {
		this.scheduleRepositionInternal();
	}

	destroy(): void {
		this.cancelReposition();
		if (this.editorView) {
			this.editorView.scrollDOM.removeEventListener("scroll", this.scrollHandler);
			this.editorView = null;
		}
		this.height = 0;
		this.lastPosition = null;
		this.state = null;

		if (this.el) {
			this.el.remove();
			this.el = null;
		}
	}

	private computeDismissalSignature(state: ToolbarState | null): string {
		const mode = state?.mode ?? "none";
		const selectionId = this.host.getSelectedSuggestionId() ?? "";
		return `${mode}:${selectionId}`;
	}

	private measureHeight(): void {
		const toolbar = this.el?.firstElementChild as HTMLElement | null;
		this.height = toolbar?.getBoundingClientRect().height ?? 0;
	}

	private scheduleRepositionInternal(): void {
		if (this.frameId !== null) {
			return;
		}

		this.frameId = window.requestAnimationFrame(() => {
			this.frameId = null;
			this.position();
		});
	}

	private cancelReposition(): void {
		if (this.frameId === null) {
			return;
		}

		window.cancelAnimationFrame(this.frameId);
		this.frameId = null;
	}

	private position(): void {
		if (!this.el || !this.editorView || !this.state) {
			return;
		}

		const editorRect = this.editorView.scrollDOM.getBoundingClientRect();
		const toolbarHeight = this.height;
		const left = editorRect.left + editorRect.width / 2;
		let clampedTop = editorRect.top + 8;
		let isHidden = false;

		if (this.state.mode === "review" || this.state.mode === "applied_review") {
			const highlightRange = this.host.getActiveHighlightRange();
			if (!highlightRange) {
				isHidden = true;
			} else {
				const coords = this.editorView.coordsAtPos(highlightRange.start);
				if (!coords) {
					isHidden = true;
				} else {
					const top = coords.top - 50 - toolbarHeight;
					const minimumTop = editorRect.top + 8;
					const maximumTop = editorRect.bottom - 8 - toolbarHeight;
					clampedTop = Math.min(Math.max(top, minimumTop), maximumTop);

					if (coords.bottom < editorRect.top || coords.top > editorRect.bottom) {
						isHidden = true;
					}
				}
			}
		} else {
			const minimumTop = editorRect.top + 12;
			const maximumTop = editorRect.bottom - 8 - toolbarHeight;
			clampedTop = Math.min(Math.max(editorRect.top + 20, minimumTop), maximumTop);
		}

		const nextPosition = {
			hidden: isHidden,
			left: `${left}px`,
			top: `${clampedTop}px`,
		};

		if (this.lastPosition?.hidden !== nextPosition.hidden) {
			this.el.classList.toggle("is-hidden", nextPosition.hidden);
		}
		if (!nextPosition.hidden) {
			if (this.lastPosition?.left !== nextPosition.left) {
				this.el.style.setProperty("--editorialist-toolbar-overlay-left", nextPosition.left);
			}
			if (this.lastPosition?.top !== nextPosition.top) {
				this.el.style.setProperty("--editorialist-toolbar-overlay-top", nextPosition.top);
			}
		}
		this.lastPosition = nextPosition;
	}
}
