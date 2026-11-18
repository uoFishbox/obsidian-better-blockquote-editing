import { Annotation, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { findQuote } from "./quote";
import type { QuoteEditorWidget } from "./quote-editor-widget";

interface EditingState {
	from: number;
	to: number;
	conflict: boolean;
	valid: boolean;
	widget: QuoteEditorWidget;
	decorations: DecorationSet;
}

export const startEditing = StateEffect.define<QuoteEditorWidget>();
export const stopEditing = StateEffect.define<QuoteEditorWidget>();
export const syncEditing = StateEffect.define<{ widget: QuoteEditorWidget; length: number }>();
export const syncConflict = StateEffect.define<QuoteEditorWidget>();
export const sourceUpdate = Annotation.define<boolean>();
export const mirroredUpdate = Annotation.define<boolean>();
export type ExitDirection = -1 | 1;

function decorate(from: number, to: number, widget: QuoteEditorWidget): DecorationSet {
	return Decoration.set([from < to
		? Decoration.replace({ widget, block: true }).range(from, to)
		: Decoration.widget({ widget, block: true, side: 1 }).range(from)]);
}

export const editingField = StateField.define<EditingState | null>({
	create: () => null,
	update(current, transaction) {
		for (const effect of transaction.effects) {
			if (effect.is(stopEditing) && current?.widget === effect.value) return null;
			if (effect.is(syncConflict) && current?.widget === effect.value) return { ...current, conflict: true };
			if (effect.is(syncEditing) && current?.widget === effect.value.widget) {
				const to = current.from + effect.value.length;
				return { ...current, to, valid: true, decorations: decorate(current.from, to, current.widget) };
			}
			if (effect.is(startEditing)) {
				const { from, to } = effect.value.quote;
				return { from, to, widget: effect.value, conflict: false, valid: true,
					decorations: decorate(from, to, effect.value) };
			}
		}
		if (!current || !transaction.docChanged) return current;
		let touched = false;
		transaction.changes.iterChangedRanges((from, to) => {
			if (from <= current.to && to >= current.from) touched = true;
		});
		let from = transaction.changes.mapPos(current.from, 1);
		let to = Math.max(from, transaction.changes.mapPos(current.to, -1));
		let valid = current.valid;
		if (touched) {
			const start = transaction.changes.mapPos(current.from, -1);
			const end = transaction.changes.mapPos(current.to, 1);
			let quote;
			for (const at of [from, start, Math.max(start, end - 1)]) {
				const block = findQuote(transaction.newDoc, at, true);
				if (block && block.from <= end && block.to >= start) {
					quote = block;
					break;
				}
			}
			valid = !!quote;
			from = quote?.from ?? start;
			to = quote?.to ?? from;
		}
		return { ...current, from, to, valid, decorations: decorate(from, to, current.widget) };
	},
	provide: (field) => EditorView.decorations.from(field, (value) => value?.decorations ?? Decoration.none),
});
