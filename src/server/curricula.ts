/**
 * THE CURRICULUM SEAM (curriculum feature, Step 1): import / save / continue
 * / mirror orchestration behind app/api/curricula/** and the Continue branch
 * of POST /api/chats. Routes stay thin transport; the pure logic is
 * core/curriculum.ts, persistence the CurriculumStore port, Obsidian IO the
 * CurriculumMirror port (both wired in stores.ts).
 *
 * Laws held here:
 *  - The vault boundary: every note/sessions path must resolve (realpath)
 *    inside settings.obsidian.vaultPath; the registry file inside
 *    obsidian.registryDir. The mirror re-checks at write time.
 *  - Import never persists: it returns a DRAFT; saving is a separate,
 *    reviewed call.
 *  - The session marker is built HERE from the stored curriculum — the
 *    client sends only a curriculumId.
 *  - Mirror failures never fail the user's action (save / Continue / a
 *    turn); they are reported in the result and logged.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { piEngineForSpec, type PiEngine } from "../agent/models.ts";
import { CURRICULUM_IMPORT_PROMPT, extractCurriculum } from "../agent/subagents/curriculum-import.ts";
import type {
	CurriculumDraft,
	CurriculumMirrorState,
	CurriculumObjective,
	CurriculumRecord,
} from "../core/contracts.ts";
import { titleFromPrompt } from "../core/contracts.ts";
import {
	currentObjective,
	curriculumOpeningPrompt,
	retrievalObjectives,
	validateCurriculumDraft,
} from "../core/curriculum.ts";
import { newCurriculumContextMessage } from "../core/native-messages.ts";
import type { MirrorProgressResult, MirrorRoots } from "../core/ports.ts";
import { sessionMarkdown } from "../core/session-markdown.ts";
import { resolveRoleSpec } from "../core/settings-resolution.ts";
import { ModelsNotConfiguredError, ProviderKeyMissingError } from "../core/settings.ts";
import { resolveInsideRoot } from "../store/obsidian-mirror.ts";
import { stampStrongSlot } from "./chats.ts";
import { providerKeyPresent } from "./keys.ts";
import { stores } from "./stores.ts";

/** A refusal the routes map to HTTP (status + machine code + optional extras). */
export class CurriculumError extends Error {
	constructor(
		readonly status: 400 | 404 | 409,
		readonly code: string,
		message: string,
		readonly extra: Record<string, unknown> = {},
	) {
		super(message);
		this.name = "CurriculumError";
	}
}

/** Map any seam failure to its HTTP response; unknown errors rethrow. The
 *  config refusals reuse the notes-import envelope family (503). */
export function curriculumFailure(err: unknown): Response {
	if (err instanceof CurriculumError) {
		return Response.json({ error: err.message, code: err.code, ...err.extra }, { status: err.status });
	}
	if (err instanceof ModelsNotConfiguredError) return Response.json(err.envelope, { status: 503 });
	if (err instanceof ProviderKeyMissingError) return Response.json(err.envelope, { status: 503 });
	throw err;
}

/** Test seam (the setTurnRunner precedent): swap the model-facing pieces of
 *  the import. Production leaves both undefined. */
export const curriculumImportHooks: {
	extract?: typeof extractCurriculum;
	engine?: () => PiEngine | undefined;
} = {};

/** The mirror's allowed write roots, read fresh from the settings record. */
export function obsidianRoots(): MirrorRoots {
	const o = stores.settingsStore.readSettings()?.obsidian;
	return { vaultPath: o?.vaultPath, registryDir: o?.registryDir };
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

function importerEngine(): PiEngine | undefined {
	const spec = resolveRoleSpec("curriculumImporter", stores.settingsStore.readSettings());
	return spec ? piEngineForSpec(spec) : undefined;
}

function requireVault(roots: MirrorRoots): string {
	if (!roots.vaultPath) {
		throw new CurriculumError(400, "vault_not_configured", "Set your Obsidian vault path in Settings → Obsidian first");
	}
	return roots.vaultPath;
}

/** The default registry index for a subject, when a registry dir is
 *  configured and the file exists. */
function defaultRegistryPath(roots: MirrorRoots, slug: string): string | undefined {
	if (!roots.registryDir || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return undefined;
	const resolved = resolveInsideRoot(roots.registryDir, path.join(roots.registryDir, slug, "index.md"));
	return resolved.ok && fs.existsSync(resolved.path) ? resolved.path : undefined;
}

/** Fill the path-valued source fields a draft needs. */
function withPathDefaults(draft: CurriculumDraft, notePath: string, roots: MirrorRoots): CurriculumDraft {
	return {
		...draft,
		source: {
			...draft.source,
			notePath,
			sessionsDir: draft.source.sessionsDir ?? path.join(path.dirname(notePath), "Sessions"),
			registryPath: draft.source.registryPath ?? defaultRegistryPath(roots, draft.subjectSlug),
		},
	};
}

/** The record, or null for an unknown OR malformed id. */
export function findCurriculum(id: string): CurriculumRecord | null {
	try {
		return stores.curriculumStore.getCurriculum(id);
	} catch {
		return null;
	}
}

// ─── import (draft only — nothing is persisted) ──────────────────────────────

export async function importCurriculumDraft(rawPath: string, signal?: AbortSignal): Promise<CurriculumDraft> {
	if (typeof rawPath !== "string" || !path.isAbsolute(rawPath) || !rawPath.toLowerCase().endsWith(".md")) {
		throw new CurriculumError(400, "invalid_path", "notePath must be an absolute path to a .md file");
	}
	const roots = obsidianRoots();
	const vault = requireVault(roots);
	const resolved = resolveInsideRoot(vault, rawPath);
	if (!resolved.ok) throw new CurriculumError(400, "outside_vault", `Note is outside the configured vault: ${resolved.reason}`);
	let markdown: string;
	try {
		markdown = fs.readFileSync(resolved.path, "utf-8");
	} catch {
		throw new CurriculumError(404, "note_not_found", "Note not found");
	}

	// The per-need refusal gates (BYOK): models, then the provider key.
	const engine = curriculumImportHooks.engine ? curriculumImportHooks.engine() : importerEngine();
	if (!engine) throw new ModelsNotConfiguredError(["strong"]);
	if (!curriculumImportHooks.engine && !providerKeyPresent(engine.model.provider)) {
		throw new ProviderKeyMissingError(engine.model.provider, ["strong"]);
	}
	const extract = curriculumImportHooks.extract ?? extractCurriculum;
	const draft = await extract({
		engine,
		notePath: resolved.path,
		markdown,
		systemPrompt: CURRICULUM_IMPORT_PROMPT,
		signal,
	});
	return withPathDefaults(draft, resolved.path, roots);
}

// ─── save ────────────────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Rebuild a draft from untrusted JSON: known fields only, types coerced to
 *  the contract's shapes (semantic problems are validateCurriculumDraft's). */
export function coerceCurriculumDraft(body: unknown): CurriculumDraft | null {
	if (!isRecord(body) || !Array.isArray(body.objectives) || !isRecord(body.source)) return null;
	const s = body.source;
	if (typeof s.notePath !== "string" || typeof s.rawMarkdown !== "string") return null;
	const objectives: CurriculumObjective[] = [];
	for (const o of body.objectives) {
		if (!isRecord(o)) return null;
		objectives.push({
			id: str(o.id),
			order: typeof o.order === "number" ? o.order : Number.NaN,
			...(typeof o.phase === "string" ? { phase: o.phase } : {}),
			title: str(o.title),
			objective: str(o.objective),
			prerequisites: strings(o.prerequisites),
			activities: strings(o.activities),
			checkpoint: str(o.checkpoint),
			evidenceCriterion: str(o.evidenceCriterion),
			cumulative: o.cumulative === true,
			status: o.status as CurriculumObjective["status"],
			...(typeof o.statusNote === "string" ? { statusNote: o.statusNote } : {}),
		});
	}
	return {
		title: str(body.title),
		aliases: strings(body.aliases),
		subjectSlug: str(body.subjectSlug),
		progressUnit: str(body.progressUnit),
		outcomes: strings(body.outcomes),
		objectives,
		source: {
			kind: "obsidian",
			notePath: s.notePath,
			...(typeof s.registryPath === "string" ? { registryPath: s.registryPath } : {}),
			...(typeof s.sessionsDir === "string" ? { sessionsDir: s.sessionsDir } : {}),
			rawMarkdown: s.rawMarkdown,
			importedAt: typeof s.importedAt === "string" ? s.importedAt : new Date().toISOString(),
		},
	};
}

export async function saveCurriculumDraft(body: unknown): Promise<{ curriculum: CurriculumRecord; mirror: MirrorProgressResult | null }> {
	const draft = coerceCurriculumDraft(body);
	if (!draft) throw new CurriculumError(400, "invalid_draft", "Not a curriculum draft", { problems: ["body is not a curriculum draft"] });
	const problems = validateCurriculumDraft(draft);
	if (problems.length > 0) throw new CurriculumError(400, "invalid_draft", "Invalid curriculum draft", { problems });

	const roots = obsidianRoots();
	const vault = requireVault(roots);
	const note = resolveInsideRoot(vault, draft.source.notePath);
	if (!note.ok) throw new CurriculumError(400, "outside_vault", `Note is outside the configured vault: ${note.reason}`);
	const withDefaults = withPathDefaults(draft, note.path, roots);
	const sessions = resolveInsideRoot(vault, withDefaults.source.sessionsDir!);
	if (!sessions.ok) throw new CurriculumError(400, "outside_vault", `Sessions folder is outside the configured vault: ${sessions.reason}`);
	let registryPath = withDefaults.source.registryPath;
	if (registryPath && roots.registryDir) {
		const reg = resolveInsideRoot(roots.registryDir, registryPath);
		if (!reg.ok) throw new CurriculumError(400, "outside_registry", `Registry file is outside the configured registry directory: ${reg.reason}`);
		registryPath = reg.path;
	}
	const record = stores.curriculumStore.createCurriculum({
		...withDefaults,
		source: { ...withDefaults.source, sessionsDir: sessions.path, registryPath },
	});
	const mirrored = mirrorCurriculum(record.id);
	return { curriculum: mirrored.record, mirror: mirrored.result };
}

// ─── mirror ──────────────────────────────────────────────────────────────────

/** Mirror progress, then persist the drift baseline for whatever was
 *  WRITTEN (an `unchanged` pass never moves the baseline — a user edit
 *  must keep tripping the conflict until a write lands). */
export function mirrorCurriculum(id: string): { record: CurriculumRecord; result: MirrorProgressResult } {
	const record = findCurriculum(id);
	if (!record) throw new CurriculumError(404, "not_found", "Unknown curriculum");
	const result = stores.curriculumMirror.writeProgress(record, obsidianRoots());
	for (const [label, r] of [["note", result.note], ["registry", result.registry]] as const) {
		if (r.outcome === "conflict" || r.outcome === "refused") console.info(`[curriculum ${id}] ${label} mirror ${r.outcome}: ${r.reason}`);
	}
	if (result.note.outcome !== "written" && result.registry.outcome !== "written") return { record, result };
	const prev = record.source.lastMirror;
	const state: CurriculumMirrorState = {
		at: new Date().toISOString(),
		noteHash: result.note.outcome === "written" && result.note.hash ? result.note.hash : (prev?.noteHash ?? sha256(record.source.rawMarkdown)),
		registryHash: result.registry.outcome === "written" ? result.registry.hash : prev?.registryHash,
	};
	return { record: stores.curriculumStore.recordMirror(id, state), result };
}

// ─── continue ────────────────────────────────────────────────────────────────

/** Start a session on the curriculum's current objective: chat + strong-slot
 *  stamp + the marker as message[0] + the session link + a progress mirror
 *  ("session started — not completion evidence"). The caller has already
 *  verified the curriculum exists (no orphan chats). */
export function continueCurriculum(id: string): { chatId: string; title: string; prompt: string; mirror: MirrorProgressResult | null } {
	const record = findCurriculum(id);
	if (!record) throw new CurriculumError(404, "not_found", "Unknown curriculum");
	const current = currentObjective(record);
	if (!current) throw new CurriculumError(409, "curriculum_completed", "Every objective in this curriculum is completed");
	const prompt = curriculumOpeningPrompt(record, current);
	const chat = stores.chatStore.createChat(titleFromPrompt(prompt));
	stampStrongSlot(chat.id);
	stores.chatStore.saveMessages(chat.id, [newCurriculumContextMessage(record, current, retrievalObjectives(record, current))]);
	stores.curriculumStore.linkSession(id, { chatId: chat.id, objectiveId: current.id, startedAt: new Date().toISOString(), title: chat.title });
	let mirror: MirrorProgressResult | null = null;
	try {
		mirror = mirrorCurriculum(id).result;
	} catch (err) {
		console.error(`[curriculum ${id}] mirror after Continue failed:`, err);
	}
	return { chatId: chat.id, title: chat.title, prompt, mirror };
}

// ─── the per-turn session-note mirror ────────────────────────────────────────

/** After a completed turn of a curriculum-linked session: mirror the
 *  session's markdown export into the curriculum's sessions folder (the
 *  file LearnHarness owns; idempotent overwrite guarded by its last-written
 *  hash). A non-linked chat is a no-op; failures log, never throw. */
export function mirrorSessionNote(chatId: string): void {
	try {
		const record = stores.curriculumStore.findByChat(chatId);
		if (!record) return;
		const link = record.sessions.find((s) => s.chatId === chatId);
		const chat = stores.chatStore.getChat(chatId);
		if (!link || !chat) return;
		const markdown = sessionMarkdown(chat.messages, { title: chat.title, anchors: false });
		const res = stores.curriculumMirror.writeSessionNote(record, link, markdown, obsidianRoots());
		if (res.outcome === "conflict" || res.outcome === "refused") {
			console.info(`[curriculum ${record.id}] session note ${res.outcome}: ${res.reason}`);
			return;
		}
		if ((res.outcome === "written" || res.outcome === "unchanged") && res.path && res.hash) {
			const changed = link.note?.path !== res.path || link.note?.hash !== res.hash;
			if (changed) stores.curriculumStore.recordSessionNote(record.id, chatId, { path: res.path, hash: res.hash });
			// The registry's Last session follows the first mirrored note.
			if (!link.note) mirrorCurriculum(record.id);
		}
	} catch (err) {
		console.error(`[chat ${chatId}] session-note mirror failed:`, err);
	}
}
