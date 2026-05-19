// Minimal transaction/repair primitive for review decisions.
//
// A review decision (reject / rewrite / defer / accept) performs an ordered
// sequence of authoritative mutations (registry decision index, UI store
// status) followed by derived re-projections (reviewer signals, scene
// inventory). If any step throws mid-sequence the prior steps must not be
// left silently committed. As each authoritative mutation succeeds the
// caller registers its inverse here; on failure the scope replays the
// inverses LIFO, best-effort, so the store status and the persisted
// decision index can never diverge from each other.
//
// Compensations are best-effort by design: a failing compensation must not
// mask the original error nor abort the remaining rollbacks. Reconciling
// the *derived* projections (signals / inventory) after rollback is the
// caller's responsibility — they are recomputed from the reverted
// authoritative state.

export type ReviewCompensation = () => void | Promise<void>;

export class ReviewMutationScope {
	private readonly compensations: ReviewCompensation[] = [];

	/** Register the inverse of an authoritative mutation that just succeeded. */
	onRollback(undo: ReviewCompensation): void {
		this.compensations.push(undo);
	}

	/** True once at least one authoritative mutation has committed. */
	get hasPendingCompensations(): boolean {
		return this.compensations.length > 0;
	}

	/**
	 * Replay every registered compensation in reverse order. Each is wrapped
	 * so a secondary failure cannot abort the rollback or surface to the
	 * caller; the scope is single-use and empties itself.
	 */
	async rollback(): Promise<void> {
		while (this.compensations.length > 0) {
			const undo = this.compensations.pop();
			if (!undo) {
				continue;
			}
			try {
				await undo();
			} catch {
				// Best-effort: keep unwinding the remaining compensations.
			}
		}
	}
}
