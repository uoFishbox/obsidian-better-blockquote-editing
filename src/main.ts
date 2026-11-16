import { Plugin } from "obsidian";
import { createInlineEditorExtension } from "./inline-editor";

export default class BetterBlockquoteEditing extends Plugin {
	onload(): void {
		this.registerEditorExtension(createInlineEditorExtension(this.app));
	}
}
