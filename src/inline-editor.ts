import { Prec, type Extension } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { App, editorLivePreviewField, Notice } from "obsidian";
import { bodyOffsetToSource, calloutTitle, findQuote, titleOffsetToSource, type QuoteBlock } from "./quote";
import { editingField, mirroredUpdate, startEditing, stopEditing } from "./editing-state";
import { QuoteEditorWidget } from "./quote-editor-widget";

export function createInlineEditorExtension(app: App): Extension {
	return [
		Prec.highest(editingField),
		ViewPlugin.define((view) => {
			let active = view.state.field(editingField, false)?.widget;
			let disposed = false;
			let scheduled = false;
			let dismissed = false;
			let pointerTarget: { from: number; title: boolean } | null = null;
			let pointerRelease: ReturnType<typeof setTimeout> | undefined;
			const scheduleSelection = () => {
				if (scheduled || disposed) return;
				scheduled = true;
				// Dispatch only after CodeMirror has finished updating, using the latest caret.
				queueMicrotask(() => {
					scheduled = false;
					if (disposed || view.state.field(editorLivePreviewField, false) !== true || !view.hasFocus || view.compositionStarted ||
						view.state.selection.ranges.length !== 1) return;
					const editing = view.state.field(editingField, false);
					const selection = view.state.selection.main;
					const head = selection.head;
					if (editing) {
						if (selection.empty && (head < editing.from || head > editing.to)) {
							editing.widget.finish(head < editing.from ? -1 : 1, true);
						}
						return;
					}
					if (dismissed || view.state.readOnly || editing !== null) return;
					const quote = findQuote(view.state.doc.toString(), selection.empty ? head : selection.to - 1, true);
					if (!selection.empty) {
						// Obsidian selects the whole rendered callout backward when its body is clicked.
						if (!quote?.header || head !== quote.from || selection.anchor !== quote.to) return;
						quote.cursor = 0;
						quote.titleCursor = null;
					}
					if (quote) {
						// Native selection may replace the clicked DOM before click is delivered.
						if (pointerTarget?.from === quote.from) {
							quote.cursor = 0;
							quote.titleCursor = pointerTarget.title ? calloutTitle(quote.header).text.length : null;
						}
						clearPointer();
						openInlineEditor(app, view, quote);
					}
				});
			};
			const onCompositionEnd = () => {
				const widget = view.state.field(editingField, false)?.widget;
				if (view.state.field(editorLivePreviewField, false) !== true) widget?.closeForSourceMode();
				else widget?.scheduleReceive();
				scheduleSelection();
			};
			const calloutTarget = (event: MouseEvent) => {
				const target = event.target;
				if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey ||
					!(target instanceof view.dom.ownerDocument.defaultView!.Element) || target.closest(".cm-editor") !== view.dom ||
					view.state.readOnly || view.compositionStarted ||
					view.state.field(editingField, false) || view.state.field(editorLivePreviewField, false) !== true) return null;
				const widget = target.closest(".bbe-inline-editor");
				if (widget && view.dom.contains(widget)) return null;
				const block = target.closest<HTMLElement>(".cm-callout");
				if (!block) return null;
				const editButton = target.closest(".edit-block-button");
				const control = target.closest("a, button, input, textarea, select, [contenteditable=true]");
				if (!editButton && ((control && block.contains(control)) ||
					!target.closest(".callout-title-inner, .callout-content"))) return null;
				return { block, title: !editButton && !!target.closest(".callout-title-inner"), editButton };
			};
			const clearPointer = () => {
				clearTimeout(pointerRelease);
				pointerTarget = null;
			};
			const onPointerDown = (event: PointerEvent) => {
				clearPointer();
				const target = event.isPrimary ? calloutTarget(event) : null;
				if (!target) return;
				const quote = findQuote(view.state.doc.toString(), view.posAtDOM(target.block), true);
				if (quote) pointerTarget = { from: quote.from, title: target.title };
			};
			const onPointerUp = () => {
				// Keep the target through native selection and click, then discard it after the gesture.
				if (pointerTarget) pointerRelease = setTimeout(clearPointer, 0);
			};
			// Decide from the clicked element, independent of native mouse/touch selection.
			const onClick = (event: MouseEvent) => {
				clearPointer();
				const target = calloutTarget(event);
				if (!target) return;
				const quote = findQuote(view.state.doc.toString(), view.posAtDOM(target.block), true);
				if (!quote) return;
				const selection = view.state.selection;
				if (!target.editButton && (selection.ranges.length !== 1 || !selection.main.empty &&
					(selection.main.head !== quote.from || selection.main.anchor !== quote.to))) return;
				quote.cursor = 0;
				quote.titleCursor = target.title ? calloutTitle(quote.header).text.length : null;
				event.preventDefault();
				event.stopImmediatePropagation();
				openInlineEditor(app, view, quote);
			};
			const ownerWindow = view.dom.ownerDocument.defaultView!;
			view.dom.addEventListener("pointerdown", onPointerDown, true);
			ownerWindow.addEventListener("pointerup", onPointerUp, true);
			ownerWindow.addEventListener("pointercancel", clearPointer, true);
			view.dom.addEventListener("keydown", clearPointer, true);
			view.dom.addEventListener("click", onClick, true);
			view.dom.addEventListener("compositionend", onCompositionEnd);
			scheduleSelection();
			return {
				update(update) {
					if (update.transactions.some((transaction) =>
						transaction.effects.some((effect) => effect.is(stopEditing)))) {
						// Restoring focus after close must not immediately open another editor.
						dismissed = true;
					} else if (update.selectionSet && !update.startState.selection.eq(update.state.selection)) {
						dismissed = false;
					}
					const editing = update.state.field(editingField);
					active = editing?.widget;
					if (update.state.field(editorLivePreviewField, false) !== true) editing?.widget.closeForSourceMode();
					editing?.widget.showConflict(editing.conflict);
					const external = update.transactions.filter(transaction => !transaction.annotation(mirroredUpdate));
					if (external.some(transaction => transaction.docChanged || transaction.selection)) {
						editing?.widget.scheduleReceive(external.some(transaction => !!transaction.selection));
					}
					if (update.selectionSet || update.focusChanged ||
						update.startState.field(editorLivePreviewField, false) !== update.state.field(editorLivePreviewField, false)) scheduleSelection();
				},
				destroy() {
					disposed = true;
					clearPointer();
					view.dom.removeEventListener("pointerdown", onPointerDown, true);
					ownerWindow.removeEventListener("pointerup", onPointerUp, true);
					ownerWindow.removeEventListener("pointercancel", clearPointer, true);
					view.dom.removeEventListener("keydown", clearPointer, true);
					view.dom.removeEventListener("click", onClick, true);
					view.dom.removeEventListener("compositionend", onCompositionEnd);
					active?.dispose();
				},
			};
		}),
	];
}

export function openInlineEditor(app: App, view: EditorView, quote: QuoteBlock): void {
	if (view.state.field(editorLivePreviewField, false) !== true) return;
	if (view.state.field(editingField, false)) {
		new Notice("このエディタで開いている引用の編集を、先に閉じてください。");
		return;
	}
	// The widget owns rendering; the source keeps the actual body caret.
	view.dispatch({ effects: startEditing.of(new QuoteEditorWidget(app, quote, view, createInlineEditorExtension(app))),
		selection: { anchor: quote.from + (quote.titleCursor !== null ? titleOffsetToSource(quote, quote.source, quote.titleCursor) :
			bodyOffsetToSource(quote, quote.source, quote.cursor)) },
		annotations: isolateHistory.of("before"), scrollIntoView: true });
}
