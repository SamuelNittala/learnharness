/**
 * THE `obsidian` SETTINGS SECTION (curriculum feature, Step 1): the allowed
 * write roots for the mirror — the vault and the learning-agent registry
 * directory. Pure sanitizer + PUT body parser; no IO.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeUserSettings } from "../src/core/settings.ts";
import { parseObsidianSettingsBody, SETTINGS_SECTIONS } from "../src/server/settings-body.ts";

describe("obsidian section — sanitizer", () => {
	it("keeps well-formed string roots, drops junk", () => {
		const out = sanitizeUserSettings({ version: 1, obsidian: { vaultPath: "/v", registryDir: "/r", junk: 1 } });
		assert.deepEqual(out?.obsidian, { vaultPath: "/v", registryDir: "/r" });
		assert.deepEqual(sanitizeUserSettings({ version: 1, obsidian: { vaultPath: 5, registryDir: "  " } })?.obsidian, {});
	});
	it("an absent section stays absent", () => {
		assert.equal(sanitizeUserSettings({ version: 1 })?.obsidian, undefined);
	});
});

describe("obsidian section — PUT parser", () => {
	it("is registered under SETTINGS_SECTIONS", () => {
		assert.equal((SETTINGS_SECTIONS as Record<string, unknown>).obsidian, parseObsidianSettingsBody);
	});
	it("accepts absolute paths and {} (clears)", () => {
		assert.deepEqual(parseObsidianSettingsBody({ vaultPath: "/Users/x/vault", registryDir: "/Users/x/reg" }), {
			ok: true,
			settings: { vaultPath: "/Users/x/vault", registryDir: "/Users/x/reg" },
		});
		assert.deepEqual(parseObsidianSettingsBody({}), { ok: true, settings: {} });
	});
	it("trims, and rejects relative paths, non-strings and non-objects", () => {
		assert.deepEqual(parseObsidianSettingsBody({ vaultPath: " /v " }), { ok: true, settings: { vaultPath: "/v" } });
		assert.equal(parseObsidianSettingsBody({ vaultPath: "relative/path" }).ok, false);
		assert.equal(parseObsidianSettingsBody({ registryDir: 3 }).ok, false);
		assert.equal(parseObsidianSettingsBody(null).ok, false);
	});
});
