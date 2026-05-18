// Shared "fire on the first pointerdown, don't double-fire on the trailing
// click" binding. Previously implemented twice (Toolbar.ts and ReviewPanel.ts)
// with diverging behavior; this is the single implementation.
//
// Toolbar uses the bare form. ReviewPanel opts into `guardInteractiveDescendants`
// (skip when the activated element is a disabled <button>, or when the event
// originated inside a nested interactive control such as a link/input/dropdown)
// to preserve its prior behavior exactly.

export interface ImmediateActionOptions {
	guardInteractiveDescendants?: boolean;
}

function isDisabledButton(element: HTMLElement): boolean {
	return element instanceof HTMLButtonElement && element.disabled;
}

function originatesFromNestedInteractive(
	element: HTMLElement,
	target: EventTarget | null,
): boolean {
	if (!(target instanceof HTMLElement) || target === element) {
		return false;
	}

	const interactiveAncestor = target.closest(
		"button, a, input, select, textarea, summary, [role='button'], [contenteditable='true'], .dropdown",
	);
	return Boolean(interactiveAncestor && interactiveAncestor !== element);
}

/**
 * Binds an immediate primary-button action to `element`. Returns a disposer
 * that removes both listeners (callers that discard it keep the prior
 * fire-and-forget behavior, since the element is dropped on re-render).
 */
export function bindImmediateAction(
	element: HTMLElement,
	onClick: (event: MouseEvent | PointerEvent) => void,
	options?: ImmediateActionOptions,
): () => void {
	const guard = options?.guardInteractiveDescendants === true;
	let handledPointerDown = false;

	const shouldIgnore = (target: EventTarget | null): boolean => {
		if (!guard) {
			return false;
		}
		return isDisabledButton(element) || originatesFromNestedInteractive(element, target);
	};

	const onPointerDown = (event: PointerEvent): void => {
		if (shouldIgnore(event.target)) {
			return;
		}
		if (event.button !== 0) {
			return;
		}

		handledPointerDown = true;
		event.preventDefault();
		event.stopPropagation();
		onClick(event);
	};

	const onClickEvent = (event: MouseEvent): void => {
		if (shouldIgnore(event.target)) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (handledPointerDown) {
			handledPointerDown = false;
			return;
		}

		onClick(event);
	};

	element.addEventListener("pointerdown", onPointerDown);
	element.addEventListener("click", onClickEvent);

	return () => {
		element.removeEventListener("pointerdown", onPointerDown);
		element.removeEventListener("click", onClickEvent);
	};
}
