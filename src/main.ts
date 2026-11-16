import { Plugin } from "obsidian";
import { createInlineEditorExtension } from "./inline-editor";
import { BetterBlockquoteSettingTab, type BetterBlockquoteSettings } from "./settings";

export default class BetterBlockquoteEditing extends Plugin {
	settings: BetterBlockquoteSettings = { backspaceBehavior: "delete", ctrlBackspaceDeletesBlock: true };

	async onload(): Promise<void> {
		const data = await this.loadData() as Partial<BetterBlockquoteSettings> | null;
		this.settings.backspaceBehavior = data?.backspaceBehavior === "edit" ? "edit" : "delete";
		this.settings.ctrlBackspaceDeletesBlock = data?.ctrlBackspaceDeletesBlock !== false;
		this.addSettingTab(new BetterBlockquoteSettingTab(this));
		this.registerEditorExtension(createInlineEditorExtension(this.app, this.settings));
	}
}
