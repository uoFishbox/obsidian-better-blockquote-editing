import { ChangeSet, Text } from "@codemirror/state";

/** The smallest single replacement between two versions of a body. */
export function textChanges(before: string, after: string): ChangeSet {
	let from = 0;
	while (from < before.length && from < after.length && before[from] === after[from]) from++;
	let to = before.length;
	let end = after.length;
	while (to > from && end > from && before[to - 1] === after[end - 1]) { to--; end--; }
	return ChangeSet.of(from === to && from === end ? [] : { from, to, insert: after.slice(from, end) }, before.length);
}

/** Inserts at a shared boundary can coexist. Replacements of the same text cannot. */
export function changesOverlap(local: ChangeSet, remote: ChangeSet): boolean {
	let overlap = false;
	local.iterChangedRanges((a, b) => remote.iterChangedRanges((c, d) => {
		if (a < d && c < b) overlap = true;
	}));
	return overlap;
}

interface PendingTextMerge {
	value: string;
	pending: ChangeSet;
	incoming: ChangeSet;
}

/** Plan a merge without changing either editor, so title and body can commit together. */
export function mergePendingText(base: string, local: string, pending: ChangeSet, remote: string): PendingTextMerge | null {
	// Both editors may already contain the same edit. Acknowledge it only once.
	if (local === remote) {
		return { value: local, pending: ChangeSet.empty(remote.length), incoming: ChangeSet.empty(local.length) };
	}
	// Cursor-only updates need no text conversion or rebasing.
	if (remote === base) {
		return { value: local, pending, incoming: ChangeSet.empty(local.length) };
	}
	const changes = textChanges(base, remote);
	if (changesOverlap(pending, changes)) return null;
	// At a shared insertion point, source text comes before embedded text.
	const incoming = changes.map(pending, true);
	return {
		value: incoming.apply(Text.of(local.split("\n"))).toString(),
		pending: pending.map(changes),
		incoming,
	};
}
