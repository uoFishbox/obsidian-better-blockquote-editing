import { Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { EmbeddableMarkdownEditorComponent } from "@mnaoumov/obsidian-lib/components/embeddable-markdown-editor-component";
import type { TFile } from "obsidian";
import { editingField, sourceUpdate, type ExitDirection } from "./editing-state";

const preventBackspaceAtStart = ViewPlugin.define(view => {
	const content = view.contentDOM;
	const preventAtStart = (event: KeyboardEvent | InputEvent) => {
		const { main, ranges } = view.state.selection;
		if (!event.isComposing && !view.compositionStarted && view.root.activeElement === content &&
			ranges.length === 1 && main.empty && main.head === 0) event.preventDefault();
	};
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Backspace" && !event.ctrlKey && !event.altKey && !event.metaKey) preventAtStart(event);
	};
	const onBeforeInput = (event: InputEvent) => {
		if (event.inputType === "deleteContentBackward") preventAtStart(event);
	};
	// iOS can bypass or defer CodeMirror's key handlers before native deletion.
	content.addEventListener("keydown", onKeyDown, true);
	content.addEventListener("beforeinput", onBeforeInput, true);
	return {
		destroy() {
			content.removeEventListener("keydown", onKeyDown, true);
			content.removeEventListener("beforeinput", onBeforeInput, true);
		},
	};
});

// Reuse the same editing capability inside the native editor. Each level edits
// its outermost quote, so Live Preview never hides a widget inside another callout.
export class NativeQuoteEditor extends EmbeddableMarkdownEditorComponent {
	constructor(params: ConstructorParameters<typeof EmbeddableMarkdownEditorComponent>[0],
		private readonly onExit: (direction: ExitDirection, vertical: boolean) => void,
		private readonly sourceFile: TFile | null,
		private readonly onSelectionChange: () => void,
		private readonly inlineExtension: Extension) {
		super(params);
	}

	onload(): void {
		// The library has no file option. Bind its private owner before it builds
		// editorInfoField, link suggestions and the clipboard manager.
		const owner: unknown = Reflect.get(this, "owner");
		if (!owner || typeof owner !== "object" || !("file" in owner) ||
			!Reflect.set(owner, "file", this.sourceFile)) {
			throw new Error("Embedded Markdown editor owner could not be bound to its source file");
		}
		super.onload();
	}

	protected handleUpdate(update: ViewUpdate, isChanged: boolean): void {
		super.handleUpdate(update, isChanged);
		if ((update.selectionSet || update.focusChanged) &&
			(!update.transactions.length || !update.transactions.every(transaction => transaction.annotation(sourceUpdate)))) this.onSelectionChange();
	}

	protected buildExtensions(): Extension[] {
		return [...super.buildExtensions(), this.inlineExtension, preventBackspaceAtStart,
			Prec.highest(keymap.of([
				{ key: "ArrowUp", run: (view) => this.exitAtEdge(view, -1, true) },
				{ key: "ArrowDown", run: (view) => this.exitAtEdge(view, 1, true) },
				{ key: "ArrowLeft", run: (view) => this.exitAtEdge(view, -1, false) },
				{ key: "ArrowRight", run: (view) => this.exitAtEdge(view, 1, false) },
			])),
		];
	}

	private exitAtEdge(view: EditorView, direction: ExitDirection, vertical: boolean): boolean {
		const { main, ranges } = view.state.selection;
		if (view.compositionStarted || !main.empty || ranges.length !== 1 ||
			view.state.field(editingField, false) || view.root.activeElement !== view.contentDOM) return false;
		const edge = direction < 0 ? 0 : view.state.doc.length;
		if (vertical) {
			// Compare visual rows so wrapped lines keep their normal arrow navigation.
			const caretCoords = view.coordsAtPos(main.head);
			const edgeCoords = view.coordsAtPos(edge);
			if (!caretCoords || !edgeCoords || Math.abs(caretCoords.top - edgeCoords.top) > 1) return false;
		} else if (main.head !== edge) return false;
		this.onExit(direction, vertical);
		return true;
	}
}
