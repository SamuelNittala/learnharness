/**
 * CURRICULUM STORE (curriculum feature, Step 1): the fs JSON adapter at
 * data/curricula. Runs under an isolated LH_DATA_DIR (the schema-stamps
 * discipline: the seam is set before any config-loading import).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test, { after } from "node:test";
import type { CurriculumDraft, CurriculumObjective } from "../src/core/contracts.ts";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-curricula-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { curriculumStore } = await import("../src/store/curricula.ts");

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

const objective = (order: number, over: Partial<CurriculumObjective> = {}): CurriculumObjective => ({
	id: `block-${order}`,
	order,
	title: `T${order}`,
	objective: `O${order}`,
	prerequisites: [],
	activities: [],
	checkpoint: "c",
	evidenceCriterion: "e",
	cumulative: false,
	status: "not-started",
	...over,
});

const RAW = "---\ntitle: X\n---\n\n# X\r\n  odd whitespace \t\n\n<!-- learning-agent:start -->\nbody\n<!-- learning-agent:end -->\n";

const draft = (title = "System Design"): CurriculumDraft => ({
	title,
	aliases: [],
	subjectSlug: "system-design",
	progressUnit: "block",
	outcomes: [],
	objectives: [objective(1), objective(2)],
	source: { kind: "obsidian", notePath: "/vault/X/Curriculum.md", rawMarkdown: RAW, importedAt: "2026-10-27T00:00:00.000Z" },
});

const file = (id: string) => path.join(TMP_DATA, "curricula", `${id}.json`);

test("create -> get round trip; the file carries version 1", () => {
	const rec = curriculumStore.createCurriculum(draft());
	assert.match(rec.id, /^cur_/);
	assert.equal(rec.version, 1);
	assert.deepEqual(rec.sessions, []);
	assert.deepEqual(curriculumStore.getCurriculum(rec.id), rec);
	assert.equal(JSON.parse(fs.readFileSync(file(rec.id), "utf8")).version, 1);
});

test("a NEWER-stamped file reads as null and is never rewritten", () => {
	const rec = curriculumStore.createCurriculum(draft("future"));
	const raw = JSON.parse(fs.readFileSync(file(rec.id), "utf8"));
	fs.writeFileSync(file(rec.id), JSON.stringify({ ...raw, version: 2 }), "utf8");
	const before = fs.readFileSync(file(rec.id), "utf8");
	assert.equal(curriculumStore.getCurriculum(rec.id), null);
	assert.throws(() => curriculumStore.linkSession(rec.id, { chatId: "c", objectiveId: "block-1", startedAt: "2026-10-27T00:00:00.000Z" }));
	assert.equal(fs.readFileSync(file(rec.id), "utf8"), before, "the future file is byte-identical");
	assert.ok(!curriculumStore.listCurricula().some((s) => s.id === rec.id), "listing skips it");
});

test("listCurricula is newest-activity first and summarizes progress", async () => {
	const a = curriculumStore.createCurriculum(draft("list-a"));
	await new Promise((r) => setTimeout(r, 5));
	const b = curriculumStore.createCurriculum(draft("list-b"));
	await new Promise((r) => setTimeout(r, 5));
	curriculumStore.replaceObjectives(a.id, [objective(1, { status: "completed" }), objective(2)]);
	const list = curriculumStore.listCurricula();
	const ia = list.findIndex((s) => s.id === a.id);
	const ib = list.findIndex((s) => s.id === b.id);
	assert.ok(ia >= 0 && ib >= 0 && ia < ib, "the touched curriculum sorts first");
	assert.equal(list[ia]!.completedCount, 1);
	assert.equal(list[ia]!.objectiveCount, 2);
});

test("replaceObjectives keeps source.rawMarkdown byte-for-byte", () => {
	const rec = curriculumStore.createCurriculum(draft("raw"));
	const next = curriculumStore.replaceObjectives(rec.id, [objective(1, { status: "completed", statusNote: "done" }), objective(2)]);
	assert.equal(next.source.rawMarkdown, RAW);
	assert.equal(curriculumStore.getCurriculum(rec.id)!.source.rawMarkdown, RAW);
	assert.equal(curriculumStore.getCurriculum(rec.id)!.objectives[0]!.status, "completed");
});

test("linkSession appends and is idempotent per chatId", () => {
	const rec = curriculumStore.createCurriculum(draft("link"));
	const link = { chatId: "chat_a", objectiveId: "block-1", startedAt: "2026-10-27T00:00:00.000Z" };
	curriculumStore.linkSession(rec.id, link);
	const again = curriculumStore.linkSession(rec.id, { ...link, objectiveId: "block-2" });
	assert.equal(again.sessions.length, 1);
	assert.equal(again.sessions[0]!.objectiveId, "block-1", "the first link stands");
	curriculumStore.linkSession(rec.id, { ...link, chatId: "chat_b" });
	assert.equal(curriculumStore.getCurriculum(rec.id)!.sessions.length, 2);
	assert.equal(curriculumStore.findByChat("chat_b")?.id, rec.id);
	assert.equal(curriculumStore.findByChat("nope"), null);
});

test("recordMirror and recordSessionNote persist their stamps", () => {
	const rec = curriculumStore.createCurriculum(draft("stamps"));
	curriculumStore.linkSession(rec.id, { chatId: "chat_s", objectiveId: "block-1", startedAt: "2026-10-27T00:00:00.000Z" });
	curriculumStore.recordMirror(rec.id, { at: "2026-10-27T01:00:00.000Z", noteHash: "abc" });
	curriculumStore.recordSessionNote(rec.id, "chat_s", { path: "/vault/Sessions/2026-10-27.md", hash: "def" });
	const got = curriculumStore.getCurriculum(rec.id)!;
	assert.equal(got.source.lastMirror?.noteHash, "abc");
	assert.equal(got.sessions[0]!.note?.hash, "def");
});

test("an invalid id throws (id-guarded filenames)", () => {
	assert.throws(() => curriculumStore.getCurriculum("../evil"));
	assert.throws(() => curriculumStore.replaceObjectives("a/b", []));
});

test("an unknown id: get -> null, mutators throw", () => {
	assert.equal(curriculumStore.getCurriculum("cur_missing"), null);
	assert.throws(() => curriculumStore.replaceObjectives("cur_missing", []));
});
