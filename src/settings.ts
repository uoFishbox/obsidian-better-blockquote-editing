import { PluginSettingTab, Setting } from "obsidian";
import type BetterBlockquoteEditing from "./main";

export interface BetterBlockquoteSettings {
	backspaceBehavior: "delete" | "edit";
	ctrlBackspaceDeletesBlock: boolean;
}

export class BetterBlockquoteSettingTab extends PluginSettingTab {
	constructor(readonly plugin: BetterBlockquoteEditing) {
		super(plugin.app, plugin);
	}

	display(): void {
		this.containerEl.empty();
		new Setting(this.containerEl)
			.setName("Backspace after block")
			.setDesc(
				"Behavior when pressing Backspace at the beginning of a line right after a callout or blockquote.",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("delete", "Delete the entire block")
					.addOption(
						"edit",
						"Move carret to the end of the editor within the block",
					)
					.setValue(this.plugin.settings.backspaceBehavior)
					.onChange(async (value) => {
						if (value !== "delete" && value !== "edit") return;
						this.plugin.settings.backspaceBehavior = value;
						this.display();
						await this.plugin.saveData(this.plugin.settings);
					}),
			);
		if (this.plugin.settings.backspaceBehavior === "edit") {
			new Setting(this.containerEl)
				.setName("Delete the entire block with Ctrl+Backspace")
				.setDesc(
					"When enabled, pressing Ctrl+Backspace at the beginning of a line right after a callout or blockquote deletes the entire block.",
				)
				.addToggle((toggle) =>
					toggle
						.setValue(
							this.plugin.settings.ctrlBackspaceDeletesBlock,
						)
						.onChange(async (value) => {
							this.plugin.settings.ctrlBackspaceDeletesBlock =
								value;
							await this.plugin.saveData(this.plugin.settings);
						}),
				);
		}
	}
}
