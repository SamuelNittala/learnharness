"use client";

import type { ObsidianSettings } from "@/src/core";
import { CommitInput, SettingsGroup, SettingsRow } from "./controls.tsx";

/**
 * The Obsidian section (curriculum feature, Step 1): the two ALLOWED WRITE
 * ROOTS of the curriculum mirror — the vault (curriculum note + sessions
 * folder) and the learning-agent registry directory. The mirror writes
 * nowhere else; an unset root skips that mirror. Replace-whole section PUT
 * (the house settings discipline); empty clears a root.
 */
export function ObsidianSection({
	obsidian,
	onSectionChange,
}: {
	obsidian: ObsidianSettings | undefined;
	onSectionChange: (next: ObsidianSettings) => void;
}) {
	const commit = (key: keyof ObsidianSettings) => (next: string) => {
		const section: ObsidianSettings = { ...obsidian };
		if (next) section[key] = next;
		else delete section[key];
		onSectionChange(section);
	};
	return (
		<SettingsGroup label="Curriculum mirror" testid="obsidian-group">
			<SettingsRow label="Vault path" hint="Absolute path of your Obsidian vault. Curriculum notes and session notes are written here only.">
				<CommitInput
					value={obsidian?.vaultPath ?? ""}
					placeholder="/path/to/vault"
					ariaLabel="Obsidian vault path"
					testid="obsidian-vault-path"
					onCommit={commit("vaultPath")}
				/>
			</SettingsRow>
			<SettingsRow label="Registry directory" hint="Absolute path of the learning-paths registry. Only its index.md progress lines are updated.">
				<CommitInput
					value={obsidian?.registryDir ?? ""}
					placeholder="/path/to/learning-paths"
					ariaLabel="Learning-paths registry directory"
					testid="obsidian-registry-dir"
					onCommit={commit("registryDir")}
				/>
			</SettingsRow>
		</SettingsGroup>
	);
}
