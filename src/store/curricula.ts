/**
 * CurriculumStore — the fs JSON adapter (one file per curriculum in
 * data/curricula/). Implements core/ports.ts CurriculumStore; record shapes
 * live in core/contracts/curriculum.ts. Same idioms as the chat store: sync
 * fs, id-guarded filenames, tab-indented JSON, a single write choke point
 * that stamps the schema version, newer-stamped files refused on read.
 * LearnHarness is the SOLE writer of these files; wired in
 * src/server/stores.ts.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import type { CurriculumStore } from "../core/ports.ts";
import type {
	CurriculumDraft,
	CurriculumMirrorState,
	CurriculumObjective,
	CurriculumRecord,
	CurriculumSessionLink,
	CurriculumSummary,
} from "../core/contracts.ts";
import { CURRENT_CURRICULUM_VERSION } from "../core/contracts.ts";

function curriculumFile(id: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid curriculum id: ${id}`);
	return path.join(PATHS.curricula, `${id}.json`);
}

/** THE WRITE CHOKE POINT: every persist carries the CURRENT version stamp. */
function writeCurriculum(record: CurriculumRecord): void {
	fs.mkdirSync(PATHS.curricula, { recursive: true });
	fs.writeFileSync(
		curriculumFile(record.id),
		JSON.stringify({ ...record, version: CURRENT_CURRICULUM_VERSION }, null, "\t"),
		"utf-8",
	);
}

function getCurriculum(id: string): CurriculumRecord | null {
	const file = curriculumFile(id);
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
	} catch {
		return null;
	}
	// Honest refusal (the chat-store ruling): a record stamped NEWER than
	// this build reads as absent, never misparsed — and mutators, which go
	// through this read, can never rewrite what they don't understand.
	const v = (parsed as { version?: unknown }).version;
	if (typeof v === "number" && v > CURRENT_CURRICULUM_VERSION) {
		console.error(`[curriculum ${id}] record stamped with schema version ${v} > ${CURRENT_CURRICULUM_VERSION} — this app build is older; refusing to read it`);
		return null;
	}
	return parsed as CurriculumRecord;
}

function mustGet(id: string): CurriculumRecord {
	const record = getCurriculum(id);
	if (!record) throw new Error(`Curriculum not found: ${id}`);
	return record;
}

function createCurriculum(draft: CurriculumDraft): CurriculumRecord {
	const now = new Date().toISOString();
	const record: CurriculumRecord = {
		...draft,
		id: `cur_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
		createdAt: now,
		updatedAt: now,
		sessions: [],
	};
	writeCurriculum(record);
	return { ...record, version: CURRENT_CURRICULUM_VERSION };
}

function allRecords(): CurriculumRecord[] {
	try {
		fs.mkdirSync(PATHS.curricula, { recursive: true });
		return fs
			.readdirSync(PATHS.curricula)
			.filter((f) => f.endsWith(".json"))
			.map((f) => getCurriculum(f.slice(0, -5)))
			.filter((r): r is CurriculumRecord => r !== null);
	} catch {
		return [];
	}
}

function listCurricula(): CurriculumSummary[] {
	return allRecords()
		.map((r) => ({
			id: r.id,
			title: r.title,
			subjectSlug: r.subjectSlug,
			updatedAt: r.updatedAt,
			objectiveCount: r.objectives.length,
			completedCount: r.objectives.filter((o) => o.status === "completed").length,
		}))
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function replaceObjectives(id: string, objectives: CurriculumObjective[]): CurriculumRecord {
	const record = mustGet(id);
	record.objectives = objectives;
	record.updatedAt = new Date().toISOString();
	writeCurriculum(record);
	return record;
}

function linkSession(id: string, link: CurriculumSessionLink): CurriculumRecord {
	const record = mustGet(id);
	if (record.sessions.some((s) => s.chatId === link.chatId)) return record;
	record.sessions = [...record.sessions, link];
	record.updatedAt = new Date().toISOString();
	writeCurriculum(record);
	return record;
}

function recordMirror(id: string, state: CurriculumMirrorState): CurriculumRecord {
	const record = mustGet(id);
	record.source = { ...record.source, lastMirror: state };
	writeCurriculum(record);
	return record;
}

function recordSessionNote(id: string, chatId: string, note: { path: string; hash: string }): CurriculumRecord {
	const record = mustGet(id);
	record.sessions = record.sessions.map((s) => (s.chatId === chatId ? { ...s, note } : s));
	writeCurriculum(record);
	return record;
}

function findByChat(chatId: string): CurriculumRecord | null {
	return allRecords().find((r) => r.sessions.some((s) => s.chatId === chatId)) ?? null;
}

export const curriculumStore: CurriculumStore = {
	createCurriculum,
	getCurriculum,
	listCurricula,
	replaceObjectives,
	linkSession,
	recordMirror,
	recordSessionNote,
	findByChat,
};
