import { Prec, type EditorSelection, type Extension } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { App, editorLivePreviewField, Notice } from "obsidian";
import { bodyOffsetToSource, calloutTitle, findQuote, titleOffsetToSource, type QuoteBlock } from "./quote";
import { editingField, mirroredUpdate, startEditing, stopEditing } from "./editing-state";
import { QuoteEditorWidget } from "./quote-editor-widget";
import { CalloutTypeModal, changeCalloutType } from "./callout-type-modal";

export function createInlineEditorExtension(app: App): Extension {
	return [
		Prec.highest(editingField),
		ViewPlugin.define((view) => {
			let active = view.state.field(editingField, false)?.widget;
			let disposed = false;
			let scheduled = false;
			let dismissed = false;
			let insertedSelection: EditorSelection | undefined;
			let pointerTarget: { from: number; title: boolean } | null = null;
			let pointerRelease: ReturnType<typeof setTimeout> | undefined;
			let typeModal: CalloutTypeModal | undefined;
			let typeTarget: { from: number; to: number } | undefined;
			const scheduleSelection = () => {
				if (scheduled || disposed) return;
				scheduled = true;
				// Dispatch only after CodeMirror has finished updating, using the latest caret.
				queueMicrotask(() => {
					scheduled = false;
					if (disposed || typeModal || view.state.field(editorLivePreviewField, false) !== true || !view.hasFocus || view.compositionStarted ||
						view.state.selection.ranges.length !== 1) return;
					const editing = view.state.field(editingField, false);
					const selection = view.state.selection.main;
					const inserted = insertedSelection?.eq(view.state.selection) === true;
					insertedSelection = undefined;
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
						// Insert callout selects its new type; clicking a rendered body selects the whole block backward.
						if (!quote?.header || !inserted && (head !== quote.from || selection.anchor !== quote.to)) return;
						quote.cursor = 0;
						quote.titleCursor = inserted ? 0 : null;
					}
					if (quote) {
						// Native selection may replace the clicked DOM before click is delivered.
						if (pointerTarget?.from === quote.from) {
							quote.cursor = 0;
							quote.titleCursor = pointerTarget.title ? calloutTitle(quote.header).text.length : null;
						}
						clearPointer();
						openInlineEditor(app, view, quote, inserted);
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
					view.state.readOnly || view.compositionStarted || view.state.field(editorLivePreviewField, false) !== true) return null;
				const widget = target.closest(".bbe-inline-editor");
				if (widget && view.dom.contains(widget)) return null;
				const block = target.closest<HTMLElement>(".cm-callout");
				if (!block) return null;
				const typeIcon = target.closest(".callout-title > .callout-icon");
				if (!typeIcon && view.state.field(editingField, false)) return null;
				const editButton = target.closest(".edit-block-button");
				const control = target.closest("a, button, input, textarea, select, [contenteditable=true]");
				if (!typeIcon && !editButton && ((control && block.contains(control)) ||
					!target.closest(".callout-title-inner, .callout-content"))) return null;
				return { block, title: !editButton && !!target.closest(".callout-title-inner"), editButton, typeIcon };
			};
			const openTypeModal = (block: HTMLElement, icon: Element) => {
				if (typeModal) return;
				const source = view.state.doc.toString();
				const firstLine = view.state.doc.lineAt(view.posAtDOM(block));
				const outer = findQuote(source, firstLine.from + Math.max(0, firstLine.text.indexOf("[!")), true);
				if (!outer) return;
				// Native nested callouts share one CM widget and therefore one DOM position.
				// Match their rendered order to actual Markdown callout headers, skipping code.
				const callouts = Array.from(block.querySelectorAll(".callout")).filter(el => !el.closest(".markdown-embed"));
				const index = callouts.indexOf(icon.closest(".callout")!);
				const quotes: QuoteBlock[] = [];
				for (const line of outer.source.matchAll(/^.*$/gm)) {
					const header = /^(?: {0,3}>[ \t]?)+\[!/.exec(line[0]);
					if (!header) continue;
					const from = outer.from + line.index!;
					const quote = findQuote(source, from + header[0].length);
					if (quote?.header && quote.from === from) quotes.push(quote);
				}
				const quote = quotes[index];
				if (!quote || quotes.length !== callouts.length) return;
				const type = /^\[!([^|\]]+)/.exec(quote.header!)?.[1];
				if (!type) return;
				typeTarget = { from: quote.from, to: quote.to };
				const focused = view.root.activeElement as HTMLElement | null;
				typeModal = new CalloutTypeModal(app, type, next => {
					if (!typeTarget || disposed || view.compositionStarted || view.state.field(editorLivePreviewField, false) !== true) return;
					const line = view.state.doc.lineAt(typeTarget.from);
					const at = line.from + Math.max(0, line.text.indexOf("[!"));
					const current = findQuote(view.state.doc.toString(), at);
					if (current?.header && current.from === typeTarget.from && current.to === typeTarget.to) {
						changeCalloutType(view, current.from, next);
					}
				}, () => {
					typeModal = undefined;
					// SuggestModal closes before invoking onChooseSuggestion.
					queueMicrotask(() => {
						typeTarget = undefined;
						if (!disposed && focused?.isConnected) focused.focus({ preventScroll: true });
					});
				});
				typeModal.open();
			};
			const clearPointer = () => {
				clearTimeout(pointerRelease);
				pointerTarget = null;
			};
			const onPointerDown = (event: PointerEvent) => {
				clearPointer();
				const target = event.isPrimary ? calloutTarget(event) : null;
				if (!target) return;
				if (target.typeIcon) {
					event.preventDefault();
					event.stopImmediatePropagation();
					return;
				}
				const quote = findQuote(view.state.doc.toString(), view.posAtDOM(target.block), true);
				if (quote) pointerTarget = { from: quote.from, title: target.title };
			};
			const onPointerUp = () => {
				// Keep the target through native selection and click, then discard it after the gesture.
				if (pointerTarget) pointerRelease = setTimeout(clearPointer, 0);
			};
			const onMouseDown = (event: MouseEvent) => {
				if (!calloutTarget(event)?.typeIcon) return;
				event.preventDefault();
				event.stopImmediatePropagation();
			};
			// Decide from the clicked element, independent of native mouse/touch selection.
			const onClick = (event: MouseEvent) => {
				clearPointer();
				const target = calloutTarget(event);
				if (!target) return;
				if (target.typeIcon) {
					event.preventDefault();
					event.stopImmediatePropagation();
					openTypeModal(target.block, target.typeIcon);
					return;
				}
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
			view.dom.addEventListener("mousedown", onMouseDown, true);
			ownerWindow.addEventListener("pointerup", onPointerUp, true);
			ownerWindow.addEventListener("pointercancel", clearPointer, true);
			view.dom.addEventListener("keydown", clearPointer, true);
			view.dom.addEventListener("click", onClick, true);
			view.dom.addEventListener("compositionend", onCompositionEnd);
			scheduleSelection();
			return {
				update(update) {
					if (update.docChanged) {
						insertedSelection = undefined;
						const selection = update.state.selection.main;
						if (update.state.selection.ranges.length === 1 && !selection.empty) {
							const quote = findQuote(update.state.doc.toString(), selection.from, true);
							const type = quote?.header && /^\[!([^|\]]+)/.exec(quote.header);
							if (quote && type) {
								const from = quote.from + quote.source.indexOf("[!");
								const to = quote.from + quote.source.indexOf("]") + 1;
								if (selection.from === from + 2 && selection.to === from + 2 + type[1]!.length) {
									// Only a newly inserted marker qualifies, never selecting or replacing an existing type.
									update.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
										if (fromB <= from && toB >= to) insertedSelection = update.state.selection;
									});
								}
							}
						}
					}
					if (typeTarget && update.docChanged) {
						typeTarget = { from: update.changes.mapPos(typeTarget.from, 1), to: update.changes.mapPos(typeTarget.to, -1) };
					}
					if (typeModal && update.state.field(editorLivePreviewField, false) !== true) typeModal.close();
					if (update.transactions.some((transaction) =>
						transaction.effects.some((effect) => effect.is(stopEditing)))) {
						// Restoring focus after close must not immediately open another editor.
						dismissed = true;
					} else if (insertedSelection || update.selectionSet && !update.startState.selection.eq(update.state.selection)) {
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
					if (insertedSelection || update.selectionSet || update.focusChanged ||
						update.startState.field(editorLivePreviewField, false) !== update.state.field(editorLivePreviewField, false)) scheduleSelection();
				},
				destroy() {
					disposed = true;
					typeModal?.close();
					clearPointer();
					view.dom.removeEventListener("pointerdown", onPointerDown, true);
					view.dom.removeEventListener("mousedown", onMouseDown, true);
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

export function openInlineEditor(app: App, view: EditorView, quote: QuoteBlock, selectTitleOnOpen = false): void {
	if (view.state.field(editorLivePreviewField, false) !== true) return;
	if (view.state.field(editingField, false)) {
		new Notice("このエディタで開いている引用の編集を、先に閉じてください。");
		return;
	}
	// The widget owns rendering; the source keeps the actual body caret.
	view.dispatch({ effects: startEditing.of(new QuoteEditorWidget(app, quote, view, createInlineEditorExtension(app), selectTitleOnOpen)),
		selection: { anchor: quote.from + (quote.titleCursor !== null ? titleOffsetToSource(quote, quote.source, quote.titleCursor) :
			bodyOffsetToSource(quote, quote.source, quote.cursor)) },
		annotations: isolateHistory.of("before"), scrollIntoView: true });
}
