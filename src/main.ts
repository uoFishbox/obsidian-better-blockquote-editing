import { EditorView } from "@codemirror/view";
import { Editor, editorLivePreviewField, Plugin } from "obsidian";
import { createInlineEditorExtension } from "./inline-editor";
import { editingField } from "./editing-state";
import { findQuote } from "./quote";
import { BetterBlockquoteSettingTab, type BetterBlockquoteSettings } from "./settings";

export default class BetterBlockquoteEditing extends Plugin {
	settings: BetterBlockquoteSettings = { backspaceBehavior: "edit", ctrlBackspaceDeletesBlock: true };

	async onload(): Promise<void> {
		const data = await this.loadData() as Partial<BetterBlockquoteSettings> | null;
		this.settings.backspaceBehavior = data?.backspaceBehavior === "delete" ? "delete" : "edit";
		this.settings.ctrlBackspaceDeletesBlock = data?.ctrlBackspaceDeletesBlock !== false;
		this.addSettingTab(new BetterBlockquoteSettingTab(this));
		this.registerEditorExtension(createInlineEditorExtension(this.app, this.settings));
	}

	private getTarget(editor: Editor) {
		const cm = (editor as Editor & { cm?: EditorView }).cm;
		if (!cm || cm.state.readOnly || cm.state.field(editorLivePreviewField, false) !== true ||
			cm.state.field(editingField, false) === undefined) return null;
		const quote = findQuote(cm.state.doc.toString(), editor.posToOffset(editor.getCursor()), true);
		return quote ? { cm, quote } : null;
	}
}
