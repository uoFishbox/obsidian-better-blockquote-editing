import { EditorView } from "@codemirror/view";
import { Editor, editorLivePreviewField, MarkdownView, Plugin } from "obsidian";
import { createInlineEditorExtension, openInlineEditor } from "./inline-editor";
import { editingField } from "./editing-state";
import { findQuote } from "./quote";

export default class BetterBlockquoteEditing extends Plugin {
	onload(): void {
		this.registerEditorExtension(createInlineEditorExtension(this.app));
		this.addCommand({
			id: "edit-quote-inline",
			name: "引用・calloutをその場で編集",
			editorCheckCallback: (checking, editor, context) => {
				if (context instanceof MarkdownView && context.getMode() !== "source") return false;
				const target = this.getTarget(editor);
				if (!target) return false;
				if (!checking) openInlineEditor(this.app, target.cm, target.quote);
				return true;
			},
		});
		this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, context) => {
			if (context instanceof MarkdownView && context.getMode() !== "source") return;
			const target = this.getTarget(editor);
			if (!target) return;
			menu.addItem((item) => item.setTitle("引用・calloutをその場で編集")
				.setIcon("text-quote").onClick(() => {
					const latest = this.getTarget(editor);
					if (latest) openInlineEditor(this.app, latest.cm, latest.quote);
				}));
		}));
	}

	private getTarget(editor: Editor) {
		const cm = (editor as Editor & { cm?: EditorView }).cm;
		if (!cm || cm.state.readOnly || cm.state.field(editorLivePreviewField, false) !== true ||
			cm.state.field(editingField, false) === undefined) return null;
		const quote = findQuote(cm.state.doc.toString(), editor.posToOffset(editor.getCursor()), true);
		return quote ? { cm, quote } : null;
	}
}
