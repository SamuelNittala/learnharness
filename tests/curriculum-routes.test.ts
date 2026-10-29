/**
 * CURRICULUM ROUTES + SEAM (curriculum feature, Step 1): import (vault
 * boundary, refusals, nothing written), save (validation + first mirror),
 * Continue through POST /api/chats (marker as message[0], strong-slot stamp,
 * session link, no orphan chats), the mirror route, and the per-turn
 * session-note mirror. Isolated LH_DATA_DIR + temp vault/registry — never the
 * real vault. The extraction itself is a stub (the importer has its own
 * suite); no network, no LLM.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import type { CurriculumDraft, CurriculumObjective } from "../src/core/contracts.ts";

// ── the seam, BEFORE any config-loading import ──────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-curricula-routes-"));
const TMP_DATA = path.join(TMP, "data");
const VAULT = path.join(TMP, "vault");
const REG = path.join(TMP, "registry");
const OUTSIDE = path.join(TMP, "outside");
process.env.LH_DATA_DIR = TMP_DATA;

const { POST: importPost } = await import("../app/api/curricula/import/route.ts");
const { GET: listGet, POST: savePost } = await import("../app/api/curricula/route.ts");
const { GET: oneGet } = await import("../app/api/curricula/[id]/route.ts");
const { POST: mirrorPost } = await import("../app/api/curricula/[id]/mirror/route.ts");
const { POST: chatsPost } = await import("../app/api/chats/route.ts");
const { curriculumImportHooks, mirrorSessionNote } = await import("../src/server/curricula.ts");
const { writeSettingsRecord } = await import("../src/server/index.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { curriculumStore } = await import("../src/store/curricula.ts");
const { PATHS } = await import("../config.ts");
const { CURRICULUM_IMPORT_PROMPT } = await import("../src/agent/subagents/curriculum-import.ts");
const { createFauxCore } = await import("@earendil-works/pi-ai");

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const NOTE = [
	"---",
	"title: System Design",
	"---",
	"",
	"# System Design",
	"",
	"<!-- learning-agent:start -->",
	"## Curriculum",
	"",
	"### Progress update",
	"",
	"- stale",
	"<!-- learning-agent:end -->",
	"",
].join("\n");

const REGISTRY = ["---", "type: learning-path", "---", "", "## Progress", "", "- Last session: none", "- Current curriculum: x", "- Current item: x", ""].join("\n");

let notePath: string;
let regPath: string;

const objective = (order: number, over: Partial<CurriculumObjective> = {}): CurriculumObjective => ({
	id: `block-${order}`,
	order,
	title: `T${order}`,
	objective: `O${order}`,
	prerequisites: order > 1 ? [`block-${order - 1}`] : [],
	activities: [],
	checkpoint: "c",
	evidenceCriterion: `E${order}`,
	cumulative: false,
	status: "not-started",
	...over,
});

function draft(over: Partial<CurriculumDraft> = {}): CurriculumDraft {
	return {
		title: "System Design",
		aliases: [],
		subjectSlug: "system-design",
		progressUnit: "block",
		outcomes: [],
		objectives: [objective(1, { status: "completed" }), objective(2, { status: "in-progress" }), objective(3)],
		source: { kind: "obsidian", notePath, rawMarkdown: NOTE, importedAt: "2026-10-27T00:00:00.000Z" },
		...over,
	};
}

const json = (url: string, body: unknown) =>
	new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

const configure = (extra: Record<string, unknown> = {}) =>
	writeSettingsRecord({ version: 1, obsidian: { vaultPath: VAULT, registryDir: REG }, ...extra });

before(() => {
	fs.mkdirSync(path.join(VAULT, "System Design"), { recursive: true });
	fs.mkdirSync(path.join(REG, "system-design"), { recursive: true });
	fs.mkdirSync(OUTSIDE, { recursive: true });
	notePath = path.join(VAULT, "System Design", "Curriculum.md");
	regPath = path.join(REG, "system-design", "index.md");
});

beforeEach(() => {
	fs.writeFileSync(notePath, NOTE, "utf8");
	fs.writeFileSync(regPath, REGISTRY, "utf8");
	fs.rmSync(PATHS.curricula, { recursive: true, force: true });
	curriculumImportHooks.extract = undefined;
	curriculumImportHooks.engine = undefined;
	configure();
});

const curriculaOnDisk = () => (fs.existsSync(PATHS.curricula) ? fs.readdirSync(PATHS.curricula) : []);
const stubEngine = () => {
	const faux = createFauxCore({});
	return { model: faux.getModel(), streamFn: faux.streamSimple };
};

describe("POST /api/curricula/import", () => {
	const post = (p: string) => importPost(json("http://t/api/curricula/import", { notePath: p }));

	it("no vault configured -> 400 vault_not_configured", async () => {
		writeSettingsRecord({ version: 1 });
		const res = await post(notePath);
		assert.equal(res.status, 400);
		assert.equal(((await res.json()) as { code: string }).code, "vault_not_configured");
	});

	it("a path outside the vault -> 400", async () => {
		fs.writeFileSync(path.join(OUTSIDE, "x.md"), "x", "utf8");
		assert.equal((await post(path.join(OUTSIDE, "x.md"))).status, 400);
	});

	it("`..` traversal -> 400", async () => {
		fs.writeFileSync(path.join(OUTSIDE, "y.md"), "y", "utf8");
		assert.equal((await post(path.join(VAULT, "..", "outside", "y.md"))).status, 400);
	});

	it("a symlink inside the vault that escapes it -> 400", async () => {
		fs.writeFileSync(path.join(OUTSIDE, "z.md"), "z", "utf8");
		const link = path.join(VAULT, "escape.md");
		fs.rmSync(link, { force: true });
		fs.symlinkSync(path.join(OUTSIDE, "z.md"), link);
		assert.equal((await post(link)).status, 400);
	});

	it("a relative path or a non-markdown file -> 400; a missing note -> 404", async () => {
		assert.equal((await post("Curriculum.md")).status, 400);
		fs.writeFileSync(path.join(VAULT, "a.txt"), "x", "utf8");
		assert.equal((await post(path.join(VAULT, "a.txt"))).status, 400);
		assert.equal((await post(path.join(VAULT, "missing.md"))).status, 404);
	});

	it("models not configured -> the 503 envelope", async () => {
		const res = await post(notePath);
		assert.equal(res.status, 503);
		assert.equal(((await res.json()) as { code: string }).code, "models_not_configured");
	});

	it("passes the live importer prompt to the extractor", async () => {
		curriculumImportHooks.engine = stubEngine;
		let seen = "";
		curriculumImportHooks.extract = async (a) => {
			seen = a.systemPrompt;
			return draft();
		};
		assert.equal((await post(notePath)).status, 200);
		assert.equal(seen, CURRICULUM_IMPORT_PROMPT);
	});

	it("valid -> 200 draft, with sensible path defaults, and NOTHING written to data/curricula", async () => {
		curriculumImportHooks.engine = stubEngine;
		curriculumImportHooks.extract = async (a) => ({ ...draft(), source: { kind: "obsidian", notePath: a.notePath, rawMarkdown: a.markdown, importedAt: "t" } });
		const res = await post(notePath);
		assert.equal(res.status, 200);
		const { draft: d } = (await res.json()) as { draft: CurriculumDraft };
		assert.equal(d.source.rawMarkdown, NOTE);
		assert.equal(d.source.notePath, fs.realpathSync(notePath));
		assert.equal(d.source.sessionsDir, path.join(path.dirname(fs.realpathSync(notePath)), "Sessions"));
		assert.equal(d.source.registryPath, path.join(fs.realpathSync(REG), "system-design", "index.md"));
		assert.deepEqual(curriculaOnDisk(), []);
	});
});

describe("POST /api/curricula (save a reviewed draft)", () => {
	it("an invalid draft -> 400 with problems; nothing written", async () => {
		const res = await savePost(json("http://t/api/curricula", draft({ objectives: [] })));
		assert.equal(res.status, 400);
		const body = (await res.json()) as { problems: string[] };
		assert.ok(body.problems.some((p) => /at least one objective/.test(p)));
		assert.deepEqual(curriculaOnDisk(), []);
	});

	it("a note path outside the vault -> 400", async () => {
		const bad = draft();
		bad.source.notePath = path.join(OUTSIDE, "x.md");
		assert.equal((await savePost(json("http://t/api/curricula", bad))).status, 400);
		assert.deepEqual(curriculaOnDisk(), []);
	});

	it("a malformed body -> 400", async () => {
		assert.equal((await savePost(json("http://t/api/curricula", { nope: true }))).status, 400);
	});

	it("valid -> 201 + record, and the first mirror rewrites only the Progress update", async () => {
		const res = await savePost(json("http://t/api/curricula", draft()));
		assert.equal(res.status, 201);
		const { curriculum, mirror } = (await res.json()) as { curriculum: { id: string; source: { lastMirror?: { noteHash: string } } }; mirror: { note: { outcome: string } } };
		assert.match(curriculum.id, /^cur_/);
		assert.equal(mirror.note.outcome, "written");
		const note = fs.readFileSync(notePath, "utf8");
		assert.ok(note.includes("- Blocks completed: **1/3**"));
		assert.ok(note.startsWith(NOTE.slice(0, NOTE.indexOf("- stale"))));
		assert.ok(fs.readFileSync(regPath, "utf8").includes("- Current item: Block 2 — T2"));
		assert.ok(curriculumStore.getCurriculum(curriculum.id)!.source.lastMirror?.noteHash, "the drift baseline is recorded");
	});

	it("GET list + GET one; unknown id -> 404", async () => {
		const saved = (await (await savePost(json("http://t/api/curricula", draft()))).json()) as { curriculum: { id: string } };
		const list = (await (await listGet()).json()) as { curricula: { id: string; completedCount: number }[] };
		assert.equal(list.curricula[0]!.id, saved.curriculum.id);
		assert.equal(list.curricula[0]!.completedCount, 1);
		const one = await oneGet(new Request("http://t"), idCtx(saved.curriculum.id));
		assert.equal(one.status, 200);
		assert.equal((await oneGet(new Request("http://t"), idCtx("cur_missing"))).status, 404);
	});
});

describe("POST /api/chats { curriculum } — Continue", () => {
	const saveOne = async () =>
		((await (await savePost(json("http://t/api/curricula", draft()))).json()) as { curriculum: { id: string } }).curriculum.id;
	const chatCount = () => (fs.existsSync(PATHS.chats) ? fs.readdirSync(PATHS.chats).length : 0);

	it("creates a chat whose message[0] is the curriculum marker for the current objective, stamps the strong slot, links the session, and mirrors", async () => {
		configure({ models: { strong: { model: { provider: "openrouter", id: "some/model" } } } });
		const id = await saveOne();
		const res = await chatsPost(json("http://t/api/chats", { title: "x", curriculum: { curriculumId: id } }));
		assert.equal(res.status, 200);
		const body = (await res.json()) as { id: string; title: string; prompt: string };
		assert.equal(body.prompt, "Continue: Block 2 — T2");
		const chat = chatStore.getChat(body.id)!;
		assert.equal(chat.messages.length, 1);
		const m = chat.messages[0] as unknown as { customType: string; content: string; details: { objective: { id: string }; retrieval: { id: string }[] } };
		assert.equal(m.customType, "curriculum-context");
		assert.equal(m.details.objective.id, "block-2");
		assert.deepEqual(m.details.retrieval.map((o) => o.id), ["block-1"]);
		assert.ok(m.content.includes("E2"));
		assert.deepEqual(chat.settings?.model, { provider: "openrouter", id: "some/model" });
		const record = curriculumStore.getCurriculum(id)!;
		assert.equal(record.sessions[0]!.chatId, body.id);
		assert.equal(record.sessions[0]!.objectiveId, "block-2");
		assert.ok(fs.readFileSync(notePath, "utf8").includes("LearnHarness session started for Block 2"));
	});

	it("an unknown curriculumId -> 400 and no orphan chat", async () => {
		const before = chatCount();
		const res = await chatsPost(json("http://t/api/chats", { title: "x", curriculum: { curriculumId: "cur_missing" } }));
		assert.equal(res.status, 400);
		assert.equal(chatCount(), before);
	});

	it("cannot combine with graph picks or practice -> 400, no chat", async () => {
		const id = await saveOne();
		const before = chatCount();
		for (const extra of [{ kind: "practice" }, { graphContext: { propositions: [{ id: "n", name: "n", statement: "s" }] } }]) {
			const res = await chatsPost(json("http://t/api/chats", { title: "x", curriculum: { curriculumId: id }, ...extra }));
			assert.equal(res.status, 400);
		}
		assert.equal(chatCount(), before);
	});

	it("a fully completed curriculum -> 409, no chat", async () => {
		const done = draft({ objectives: [objective(1, { status: "completed" })] });
		const id = ((await (await savePost(json("http://t/api/curricula", done))).json()) as { curriculum: { id: string } }).curriculum.id;
		const before = chatCount();
		assert.equal((await chatsPost(json("http://t/api/chats", { title: "x", curriculum: { curriculumId: id } }))).status, 409);
		assert.equal(chatCount(), before);
	});
});

describe("POST /api/curricula/:id/mirror", () => {
	it("re-mirrors; a note edited since is a conflict and stays untouched", async () => {
		const id = ((await (await savePost(json("http://t/api/curricula", draft()))).json()) as { curriculum: { id: string } }).curriculum.id;
		const again = (await (await mirrorPost(new Request("http://t", { method: "POST" }), idCtx(id))).json()) as { mirror: { note: { outcome: string } } };
		assert.equal(again.mirror.note.outcome, "unchanged");
		fs.appendFileSync(notePath, "user edit\n");
		const res = await mirrorPost(new Request("http://t", { method: "POST" }), idCtx(id));
		// drift only matters when there is something to write: change a status first
		const rec = curriculumStore.getCurriculum(id)!;
		curriculumStore.replaceObjectives(id, rec.objectives.map((o) => (o.id === "block-2" ? { ...o, status: "completed" as const } : o)));
		const res2 = (await (await mirrorPost(new Request("http://t", { method: "POST" }), idCtx(id))).json()) as { mirror: { note: { outcome: string } } };
		assert.equal(res.status, 200);
		assert.equal(res2.mirror.note.outcome, "conflict");
		assert.ok(fs.readFileSync(notePath, "utf8").endsWith("user edit\n"));
	});

	it("unknown id -> 404", async () => {
		assert.equal((await mirrorPost(new Request("http://t", { method: "POST" }), idCtx("cur_missing"))).status, 404);
	});
});

describe("mirrorSessionNote (the per-turn session-note mirror)", () => {
	it("writes YYYY-MM-DD.md into Sessions/, overwrites only its own file on later turns, and records the stamp", async () => {
		configure({ models: { strong: { model: { provider: "openrouter", id: "m" } } } });
		const id = ((await (await savePost(json("http://t/api/curricula", draft()))).json()) as { curriculum: { id: string } }).curriculum.id;
		const chatId = ((await (await chatsPost(json("http://t/api/chats", { title: "x", curriculum: { curriculumId: id } }))).json()) as { id: string }).id;
		const msgs = chatStore.getChat(chatId)!.messages;
		chatStore.saveMessages(chatId, [...msgs, { id: "u1", role: "user", content: "retrieval answer one" } as never]);

		mirrorSessionNote(chatId);
		const sessionsDir = path.join(fs.realpathSync(VAULT), "System Design", "Sessions");
		const files = fs.readdirSync(sessionsDir);
		assert.equal(files.length, 1);
		assert.match(files[0]!, /^\d{4}-\d{2}-\d{2}\.md$/);
		assert.ok(fs.readFileSync(path.join(sessionsDir, files[0]!), "utf8").includes("retrieval answer one"));
		const link = curriculumStore.getCurriculum(id)!.sessions[0]!;
		assert.equal(link.note?.path, path.join(sessionsDir, files[0]!));

		chatStore.saveMessages(chatId, [...chatStore.getChat(chatId)!.messages, { id: "u2", role: "user", content: "second turn" } as never]);
		mirrorSessionNote(chatId);
		assert.equal(fs.readdirSync(sessionsDir).length, 1, "same file, no new one");
		assert.ok(fs.readFileSync(path.join(sessionsDir, files[0]!), "utf8").includes("second turn"));
		assert.ok(fs.readFileSync(regPath, "utf8").includes(`- Last session: `), "registry Last session follows");
	});

	it("an unlinked chat is a no-op", () => {
		fs.rmSync(path.join(VAULT, "System Design", "Sessions"), { recursive: true, force: true });
		const chat = chatStore.createChat("plain");
		mirrorSessionNote(chat.id);
		assert.equal(fs.existsSync(path.join(VAULT, "System Design", "Sessions")), false);
	});
});
