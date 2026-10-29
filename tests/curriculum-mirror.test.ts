/**
 * CURRICULUM MIRROR (curriculum feature, Step 1): the one-way Obsidian
 * writer. Every path here is a fresh temp directory — this suite NEVER
 * touches a real vault or the learning-agent registry.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";
import type { CurriculumObjective, CurriculumRecord } from "../src/core/contracts.ts";
import { renderProgressSection } from "../src/core/curriculum.ts";
import { curriculumMirror, resolveInsideRoot } from "../src/store/obsidian-mirror.ts";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-mirror-"));
const VAULT = path.join(TMP, "vault");
const REG = path.join(TMP, "registry");
const OUTSIDE = path.join(TMP, "outside");
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const NOTE = [
	"---",
	"title: System Design",
	"---",
	"",
	"# System Design",
	"",
	"User paragraph outside the markers.",
	"",
	"<!-- learning-agent:start -->",
	"## Curriculum",
	"",
	"### Status",
	"",
	"**Current item:** Block 2",
	"",
	"### Progress update",
	"",
	"- stale",
	"<!-- learning-agent:end -->",
	"",
	"Trailing user text.",
	"",
].join("\n");

const REGISTRY = [
	"---",
	"type: learning-path",
	"---",
	"",
	"## Curricula",
	"",
	"- title: X",
	"",
	"## Progress",
	"",
	"- Last session: 2026-08-29 — `/old.md`",
	"- Current curriculum: old",
	"- Current item: old",
	"- Notes: keep me.",
	"",
].join("\n");

const objective = (order: number, over: Partial<CurriculumObjective> = {}): CurriculumObjective => ({
	id: `block-${order}`,
	order,
	title: `T${order}`,
	objective: "o",
	prerequisites: [],
	activities: [],
	checkpoint: "c",
	evidenceCriterion: "e",
	cumulative: false,
	status: "not-started",
	...over,
});

let notePath: string;
let regPath: string;

function rec(over: Partial<CurriculumRecord> = {}): CurriculumRecord {
	return {
		id: "cur_t",
		title: "System Design",
		aliases: [],
		subjectSlug: "system-design",
		progressUnit: "block",
		createdAt: "2026-10-27T00:00:00.000Z",
		updatedAt: "2026-10-27T00:00:00.000Z",
		outcomes: [],
		objectives: [objective(1, { status: "completed" }), objective(2, { status: "in-progress" })],
		source: {
			kind: "obsidian",
			notePath,
			registryPath: regPath,
			sessionsDir: path.join(VAULT, "System Design", "Sessions"),
			rawMarkdown: NOTE,
			importedAt: "2026-10-27T00:00:00.000Z",
		},
		sessions: [],
		...over,
	};
}

before(() => {
	fs.mkdirSync(path.join(VAULT, "System Design"), { recursive: true });
	fs.mkdirSync(path.join(REG, "system-design"), { recursive: true });
	fs.mkdirSync(OUTSIDE, { recursive: true });
	notePath = path.join(VAULT, "System Design", "Curriculum.md");
	regPath = path.join(REG, "system-design", "index.md");
});

const reset = () => {
	fs.writeFileSync(notePath, NOTE, "utf8");
	fs.writeFileSync(regPath, REGISTRY, "utf8");
};
const roots = () => ({ vaultPath: VAULT, registryDir: REG });

describe("resolveInsideRoot", () => {
	it("accepts a file inside the root and a not-yet-existing file in an existing dir", () => {
		reset();
		assert.equal(resolveInsideRoot(VAULT, notePath).ok, true);
		assert.equal(resolveInsideRoot(VAULT, path.join(VAULT, "System Design", "new.md")).ok, true);
	});
	it("rejects .. traversal, an outside path, and a symlink that escapes", () => {
		reset();
		assert.equal(resolveInsideRoot(VAULT, path.join(VAULT, "..", "outside", "x.md")).ok, false);
		assert.equal(resolveInsideRoot(VAULT, path.join(OUTSIDE, "x.md")).ok, false);
		fs.writeFileSync(path.join(OUTSIDE, "secret.md"), "s", "utf8");
		const link = path.join(VAULT, "escape.md");
		fs.rmSync(link, { force: true });
		fs.symlinkSync(path.join(OUTSIDE, "secret.md"), link);
		assert.equal(resolveInsideRoot(VAULT, link).ok, false);
		const dirLink = path.join(VAULT, "escape-dir");
		fs.rmSync(dirLink, { force: true });
		fs.symlinkSync(OUTSIDE, dirLink);
		assert.equal(resolveInsideRoot(VAULT, path.join(dirLink, "new.md")).ok, false);
	});
	it("a sibling directory sharing the root's name prefix is outside", () => {
		fs.mkdirSync(`${VAULT}-evil`, { recursive: true });
		assert.equal(resolveInsideRoot(VAULT, path.join(`${VAULT}-evil`, "x.md")).ok, false);
	});
});

describe("writeProgress — the curriculum note", () => {
	it("changes only the Progress update body; YAML, other sections, outside text are byte-identical", () => {
		reset();
		const r = rec();
		const res = curriculumMirror.writeProgress(r, roots());
		assert.equal(res.note.outcome, "written");
		const after = fs.readFileSync(notePath, "utf8");
		const head = NOTE.slice(0, NOTE.indexOf("### Progress update") + "### Progress update".length);
		assert.equal(after.slice(0, head.length), head);
		assert.equal(after.slice(after.indexOf("<!-- learning-agent:end -->")), NOTE.slice(NOTE.indexOf("<!-- learning-agent:end -->")));
		assert.ok(after.includes(renderProgressSection(r)));
		assert.equal(res.note.hash, sha(after));
	});

	it("running twice with the same record is unchanged — no second write", () => {
		reset();
		const r = rec();
		const first = curriculumMirror.writeProgress(r, roots());
		const mtime = fs.statSync(notePath).mtimeMs;
		const second = curriculumMirror.writeProgress(
			{ ...r, source: { ...r.source, lastMirror: { at: "x", noteHash: first.note.hash!, registryHash: first.registry.hash } } },
			roots(),
		);
		assert.equal(second.note.outcome, "unchanged");
		assert.equal(second.registry.outcome, "unchanged");
		assert.equal(fs.statSync(notePath).mtimeMs, mtime);
	});

	it("hash drift (note edited since the baseline) is a conflict and writes nothing", () => {
		reset();
		const r = rec({ source: { ...rec().source, lastMirror: { at: "x", noteHash: sha(NOTE) } } });
		fs.writeFileSync(notePath, NOTE + "\nuser edit\n", "utf8");
		const res = curriculumMirror.writeProgress(r, roots());
		assert.equal(res.note.outcome, "conflict");
		assert.equal(fs.readFileSync(notePath, "utf8"), NOTE + "\nuser edit\n");
	});

	it("with no lastMirror the import baseline (hash of rawMarkdown) guards the first write", () => {
		reset();
		fs.writeFileSync(notePath, NOTE + "edited after import\n", "utf8");
		assert.equal(curriculumMirror.writeProgress(rec(), roots()).note.outcome, "conflict");
	});

	it("markers missing -> refused, file untouched", () => {
		reset();
		const bare = "# no markers\n";
		fs.writeFileSync(notePath, bare, "utf8");
		const r = rec({ source: { ...rec().source, rawMarkdown: bare } });
		const res = curriculumMirror.writeProgress(r, roots());
		assert.equal(res.note.outcome, "refused");
		assert.equal(fs.readFileSync(notePath, "utf8"), bare);
	});

	it("heading missing inside the markers -> refused", () => {
		reset();
		const noHeading = NOTE.replace("### Progress update", "### Other");
		fs.writeFileSync(notePath, noHeading, "utf8");
		const r = rec({ source: { ...rec().source, rawMarkdown: noHeading } });
		assert.equal(curriculumMirror.writeProgress(r, roots()).note.outcome, "refused");
		assert.equal(fs.readFileSync(notePath, "utf8"), noHeading);
	});

	it("a note path outside the vault root is refused", () => {
		reset();
		fs.writeFileSync(path.join(OUTSIDE, "Curriculum.md"), NOTE, "utf8");
		const r = rec({ source: { ...rec().source, notePath: path.join(OUTSIDE, "Curriculum.md") } });
		const res = curriculumMirror.writeProgress(r, roots());
		assert.equal(res.note.outcome, "refused");
		assert.equal(fs.readFileSync(path.join(OUTSIDE, "Curriculum.md"), "utf8"), NOTE);
	});

	it("no vault configured -> skipped", () => {
		reset();
		assert.equal(curriculumMirror.writeProgress(rec(), { registryDir: REG }).note.outcome, "skipped");
	});
});

describe("writeProgress — the registry", () => {
	it("changes only the managed bullets of ## Progress; YAML, ## Curricula, Notes untouched", () => {
		reset();
		const res = curriculumMirror.writeProgress(rec(), roots());
		assert.equal(res.registry.outcome, "written");
		const after = fs.readFileSync(regPath, "utf8");
		assert.equal(after.slice(0, after.indexOf("## Progress")), REGISTRY.slice(0, REGISTRY.indexOf("## Progress")));
		assert.ok(after.includes("- Current curriculum: System Design"));
		assert.ok(after.includes("- Current item: Block 2 — T2"));
		assert.ok(after.includes("- Notes: keep me."));
		assert.ok(after.includes("- Last session: 2026-08-29"), "no session note yet: Last session is left alone");
	});

	it("registry drift against the recorded hash is a conflict", () => {
		reset();
		const first = curriculumMirror.writeProgress(rec(), roots());
		fs.appendFileSync(regPath, "user edit\n");
		const r = rec({ source: { ...rec().source, lastMirror: { at: "x", noteHash: first.note.hash!, registryHash: first.registry.hash } } });
		const res = curriculumMirror.writeProgress({ ...r, objectives: [objective(1, { status: "completed" }), objective(2, { status: "completed" })] }, roots());
		assert.equal(res.registry.outcome, "conflict");
		assert.ok(fs.readFileSync(regPath, "utf8").endsWith("user edit\n"));
	});

	it("a registry path outside the registry dir is refused; no registryDir -> skipped", () => {
		reset();
		fs.writeFileSync(path.join(OUTSIDE, "index.md"), REGISTRY, "utf8");
		const r = rec({ source: { ...rec().source, registryPath: path.join(OUTSIDE, "index.md") } });
		assert.equal(curriculumMirror.writeProgress(r, roots()).registry.outcome, "refused");
		assert.equal(curriculumMirror.writeProgress(rec(), { vaultPath: VAULT }).registry.outcome, "skipped");
	});

	it("the registry's Last session follows the latest mirrored session note", () => {
		reset();
		const r = rec({
			sessions: [{ chatId: "c1", objectiveId: "block-2", startedAt: "2026-10-27T12:00:00.000Z", note: { path: "/v/Sessions/2026-10-27.md", hash: "h" } }],
		});
		curriculumMirror.writeProgress(r, roots());
		assert.ok(fs.readFileSync(regPath, "utf8").includes("- Last session: 2026-10-27 — `/v/Sessions/2026-10-27.md`"));
	});
});

describe("writeSessionNote", () => {
	const sessionsDir = () => path.join(VAULT, "System Design", "Sessions");
	const link = (chatId: string, over = {}) => ({ chatId, objectiveId: "block-2", startedAt: "2026-10-27T12:00:00.000Z", ...over });

	it("creates YYYY-MM-DD.md in the sessions folder (created if absent)", () => {
		fs.rmSync(sessionsDir(), { recursive: true, force: true });
		const res = curriculumMirror.writeSessionNote(rec(), link("c1"), "# S1\n\nbody", roots());
		assert.equal(res.outcome, "written");
		assert.equal(path.basename(res.path!), "2026-10-27.md");
		assert.equal(fs.readFileSync(res.path!, "utf8"), "# S1\n\nbody\n");
		assert.equal(res.hash, sha("# S1\n\nbody\n"));
	});

	it("a same-day collision with a file LearnHarness did not create gets -2, -3; the foreign file is never overwritten", () => {
		fs.rmSync(sessionsDir(), { recursive: true, force: true });
		fs.mkdirSync(sessionsDir(), { recursive: true });
		fs.writeFileSync(path.join(sessionsDir(), "2026-10-27.md"), "foreign", "utf8");
		const a = curriculumMirror.writeSessionNote(rec(), link("c1"), "A", roots());
		const b = curriculumMirror.writeSessionNote(rec(), link("c2"), "B", roots());
		assert.equal(path.basename(a.path!), "2026-10-27-2.md");
		assert.equal(path.basename(b.path!), "2026-10-27-3.md");
		assert.equal(fs.readFileSync(path.join(sessionsDir(), "2026-10-27.md"), "utf8"), "foreign");
	});

	it("re-writing a session overwrites only its own file, guarded by the last-written hash", () => {
		fs.rmSync(sessionsDir(), { recursive: true, force: true });
		const first = curriculumMirror.writeSessionNote(rec(), link("c1"), "v1", roots());
		const owned = link("c1", { note: { path: first.path!, hash: first.hash! } });
		const second = curriculumMirror.writeSessionNote(rec(), owned, "v2", roots());
		assert.equal(second.outcome, "written");
		assert.equal(second.path, first.path);
		assert.equal(fs.readFileSync(first.path!, "utf8"), "v2\n");
		const same = curriculumMirror.writeSessionNote(rec(), { ...owned, note: { path: first.path!, hash: second.hash! } }, "v2", roots());
		assert.equal(same.outcome, "unchanged");
	});

	it("a session note edited since LearnHarness wrote it is a conflict", () => {
		fs.rmSync(sessionsDir(), { recursive: true, force: true });
		const first = curriculumMirror.writeSessionNote(rec(), link("c1"), "v1", roots());
		fs.appendFileSync(first.path!, "user wrote here\n");
		const res = curriculumMirror.writeSessionNote(rec(), link("c1", { note: { path: first.path!, hash: first.hash! } }), "v2", roots());
		assert.equal(res.outcome, "conflict");
		assert.ok(fs.readFileSync(first.path!, "utf8").endsWith("user wrote here\n"));
	});

	it("a sessions folder outside the vault is refused; no vault -> skipped", () => {
		const r = rec({ source: { ...rec().source, sessionsDir: path.join(OUTSIDE, "Sessions") } });
		assert.equal(curriculumMirror.writeSessionNote(r, link("c1"), "x", roots()).outcome, "refused");
		assert.equal(fs.existsSync(path.join(OUTSIDE, "Sessions")), false);
		assert.equal(curriculumMirror.writeSessionNote(rec(), link("c1"), "x", {}).outcome, "skipped");
	});

	it("an owned note path that escapes the vault is refused", () => {
		const res = curriculumMirror.writeSessionNote(rec(), link("c1", { note: { path: path.join(OUTSIDE, "x.md"), hash: "h" } }), "x", roots());
		assert.equal(res.outcome, "refused");
	});
});

describe("writeProgress — static Progress lines survive the mirror", () => {
	it("carries Calendar deadline / Session maximum / Remediation lines over byte-for-byte; absent -> none written", () => {
		const lines = ["- Calendar deadline: **none**", "- Session maximum: **none**  ", "- Remediation/retake maximum: **none**"];
		const withStatic = NOTE.replace("- stale", ["- Blocks completed: **1/2**", "- Current block: **x**", "- Last completed evidence: y", ...lines, "", "- [x] Block 1 — T1"].join("\n"));
		fs.writeFileSync(notePath, withStatic, "utf8");
		fs.writeFileSync(regPath, REGISTRY, "utf8");
		const r = rec({ source: { ...rec().source, rawMarkdown: withStatic } });
		assert.equal(curriculumMirror.writeProgress(r, roots()).note.outcome, "written");
		const out = fs.readFileSync(notePath, "utf8");
		assert.ok(out.includes(lines.join("\n") + "\n"), "kept verbatim and contiguous");
		assert.ok(out.indexOf("- Last completed evidence:") < out.indexOf(lines[0]!));

		reset();
		curriculumMirror.writeProgress(rec(), roots());
		assert.ok(!/Calendar deadline|Session maximum|Remediation/.test(fs.readFileSync(notePath, "utf8")));
	});
});
