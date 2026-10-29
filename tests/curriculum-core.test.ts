/**
 * CURRICULUM CORE (curriculum feature, Step 1): the pure logic — draft
 * validation, current-objective selection, the delayed-retrieval set, the
 * marker text, the Obsidian progress rendering, and the byte-preserving
 * splices. No IO anywhere: the store/mirror have their own suites.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CurriculumDraft, CurriculumObjective, CurriculumRecord } from "../src/core/contracts.ts";
import {
	curriculumContextText,
	curriculumOpeningPrompt,
	currentObjective,
	objectiveLabel,
	renderProgressSection,
	retrievalObjectives,
	spliceRegistryProgress,
	spliceSubsection,
	staticProgressLines,
	validateCurriculumDraft,
} from "../src/core/curriculum.ts";

function obj(order: number, over: Partial<CurriculumObjective> = {}): CurriculumObjective {
	return {
		id: `block-${order}`,
		order,
		title: `Title ${order}`,
		objective: `Objective ${order}`,
		prerequisites: order > 1 ? [`block-${order - 1}`] : [],
		activities: ["read", "design"],
		checkpoint: `Checkpoint ${order}`,
		evidenceCriterion: `Evidence ${order}`,
		cumulative: false,
		status: "not-started",
		...over,
	};
}

function draft(objectives: CurriculumObjective[]): CurriculumDraft {
	return {
		title: "System Design",
		aliases: ["sd"],
		subjectSlug: "system-design",
		progressUnit: "block",
		outcomes: ["design systems"],
		objectives,
		source: { kind: "obsidian", notePath: "/v/System Design/Curriculum.md", rawMarkdown: "raw", importedAt: "2026-10-27T00:00:00.000Z" },
	};
}

function record(objectives: CurriculumObjective[]): CurriculumRecord {
	return { ...draft(objectives), id: "cur_x", createdAt: "2026-10-27T00:00:00.000Z", updatedAt: "2026-10-27T00:00:00.000Z", sessions: [] };
}

describe("validateCurriculumDraft", () => {
	it("a valid draft has no problems", () => {
		assert.deepEqual(validateCurriculumDraft(draft([obj(1), obj(2)])), []);
	});

	it("rejects an empty objective list", () => {
		assert.ok(validateCurriculumDraft(draft([])).some((p) => /at least one objective/i.test(p)));
	});

	it("rejects a duplicate id", () => {
		const problems = validateCurriculumDraft(draft([obj(1), obj(2, { id: "block-1" })]));
		assert.ok(problems.some((p) => /duplicate/i.test(p) && p.includes("block-1")));
	});

	it("rejects an unknown prerequisite", () => {
		const problems = validateCurriculumDraft(draft([obj(1), obj(2, { prerequisites: ["block-9"] })]));
		assert.ok(problems.some((p) => /unknown prerequisite/i.test(p) && p.includes("block-9")));
	});

	it("rejects a dependency cycle", () => {
		const problems = validateCurriculumDraft(
			draft([obj(1, { prerequisites: ["block-2"] }), obj(2, { prerequisites: ["block-1"] })]),
		);
		assert.ok(problems.some((p) => /cycle/i.test(p)));
	});

	it("rejects a self prerequisite as a cycle", () => {
		const problems = validateCurriculumDraft(draft([obj(1, { prerequisites: ["block-1"] })]));
		assert.ok(problems.some((p) => /cycle/i.test(p)));
	});

	it("rejects an empty evidenceCriterion", () => {
		const problems = validateCurriculumDraft(draft([obj(1, { evidenceCriterion: "  " })]));
		assert.ok(problems.some((p) => /evidenceCriterion/.test(p) && p.includes("block-1")));
	});

	it("rejects non-contiguous order", () => {
		const problems = validateCurriculumDraft(draft([obj(1), obj(3, { prerequisites: [] })]));
		assert.ok(problems.some((p) => /order/i.test(p)));
	});

	it("rejects an empty title / subjectSlug and a non-kebab slug", () => {
		const d = draft([obj(1)]);
		assert.ok(validateCurriculumDraft({ ...d, title: " " }).some((p) => /title/i.test(p)));
		assert.ok(validateCurriculumDraft({ ...d, subjectSlug: "System Design" }).some((p) => /subjectSlug/.test(p)));
	});
});

describe("currentObjective", () => {
	it("first not-completed objective in order", () => {
		const r = record([obj(1, { status: "completed" }), obj(2, { status: "completed" }), obj(3), obj(4)]);
		assert.equal(currentObjective(r)?.id, "block-3");
	});

	it("an in-progress objective resumes before a not-started one", () => {
		const r = record([
			obj(1, { status: "completed" }),
			obj(2, { prerequisites: ["block-1"] }),
			obj(3, { prerequisites: ["block-1"], status: "in-progress" }),
		]);
		assert.equal(currentObjective(r)?.id, "block-3");
	});

	it("skips an objective whose prerequisites are incomplete (order follows prerequisites)", () => {
		const r = record([
			obj(1, { status: "completed" }),
			obj(2, { prerequisites: ["block-3"] }),
			obj(3, { prerequisites: ["block-1"] }),
		]);
		assert.equal(currentObjective(r)?.id, "block-3");
	});

	it("null when everything is completed", () => {
		assert.equal(currentObjective(record([obj(1, { status: "completed" })])), null);
	});
});

describe("retrievalObjectives", () => {
	it("completed direct prerequisites plus the most recently completed, in prerequisite order", () => {
		const r = record([
			obj(1, { status: "completed", prerequisites: [] }),
			obj(2, { status: "completed", prerequisites: ["block-1"] }),
			obj(3, { status: "completed", prerequisites: ["block-1"] }),
			obj(4, { prerequisites: ["block-2"], status: "in-progress" }),
		]);
		const current = currentObjective(r)!;
		// block-2 is the direct prerequisite; block-3 is the most recently completed.
		assert.deepEqual(retrievalObjectives(r, current).map((o) => o.id), ["block-2", "block-3"]);
	});

	it("includes only completed prerequisites", () => {
		const r = record([obj(1, { status: "completed" }), obj(2, { prerequisites: ["block-1", "block-3"] }), obj(3, { prerequisites: [] })]);
		const ids = retrievalObjectives(r, r.objectives[1]!).map((o) => o.id);
		assert.ok(ids.includes("block-1"));
		assert.ok(!ids.includes("block-3"));
	});

	it("caps at 3, always keeping the most recently completed", () => {
		const r = record([
			obj(1, { status: "completed", prerequisites: [] }),
			obj(2, { status: "completed", prerequisites: [] }),
			obj(3, { status: "completed", prerequisites: [] }),
			obj(4, { status: "completed", prerequisites: [] }),
			obj(5, { status: "completed", prerequisites: [] }),
			obj(6, { prerequisites: ["block-1", "block-2", "block-3", "block-4"] }),
		]);
		const ids = retrievalObjectives(r, r.objectives[5]!).map((o) => o.id);
		assert.equal(ids.length, 3);
		assert.ok(ids.includes("block-5"), "the most recently completed is kept");
		assert.deepEqual(ids, [...ids].sort((a, b) => a.localeCompare(b)), "ordered by prerequisite/order");
	});

	it("empty when nothing is completed", () => {
		const r = record([obj(1)]);
		assert.deepEqual(retrievalObjectives(r, r.objectives[0]!), []);
	});

	it("never includes the current objective itself", () => {
		const r = record([obj(1, { status: "completed" }), obj(2, { status: "in-progress" })]);
		assert.ok(!retrievalObjectives(r, r.objectives[1]!).some((o) => o.id === "block-2"));
	});
});

describe("curriculumContextText", () => {
	const r = record([obj(1, { status: "completed" }), obj(2, { status: "in-progress", cumulative: true })]);
	const current = r.objectives[1]!;
	const text = curriculumContextText(r, current, retrievalObjectives(r, current));

	it("opens with the [Curriculum context] preamble", () => {
		assert.ok(text.startsWith("[Curriculum context]"));
	});

	it("carries the objective id, title and evidence criterion", () => {
		assert.ok(text.includes("block-2"));
		assert.ok(text.includes("Title 2"));
		assert.ok(text.includes("Evidence 2"));
	});

	it("lists the prior objectives with the closed-note, before-new-teaching instruction", () => {
		assert.ok(text.includes("block-1"));
		assert.match(text, /closed-note/i);
		assert.match(text, /before (any )?new teaching/i);
	});

	it("flags a cumulative objective", () => {
		assert.match(text, /cumulative/i);
	});

	it("with no prior objectives, says there is nothing to retrieve", () => {
		const first = record([obj(1)]);
		const t = curriculumContextText(first, first.objectives[0]!, []);
		assert.match(t, /no prior objectives/i);
	});
});

describe("labels and the opening prompt", () => {
	it("objectiveLabel uses the progress unit and order", () => {
		assert.equal(objectiveLabel(record([obj(1)]), obj(1)), "Block 1 — Title 1");
	});
	it("opening prompt is the fixed template", () => {
		const r = record([obj(1)]);
		assert.equal(curriculumOpeningPrompt(r, obj(1)), "Continue: Block 1 — Title 1");
	});
});

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
	"**Current item:** Block 4",
	"",
	"### Progress update",
	"",
	"- Blocks completed: **3/30**",
	"",
	"**Next action:** retrieve things.",
	"<!-- learning-agent:end -->",
	"",
	"Trailing user text.",
	"",
].join("\n");

describe("renderProgressSection", () => {
	const r = record([
		obj(1, { status: "completed", statusNote: "Block 1 probe checkpoint — [[2026-08-20]]" }),
		obj(2, { status: "completed", statusNote: "Block 2 estimation checkpoint" }),
		obj(3, { status: "in-progress", statusNote: "Coached application done; checkpoint pending." }),
		obj(4),
	]);

	it("keeps the note's shape: counts, current, checklist, latest evidence, next action", () => {
		const out = renderProgressSection(r);
		assert.match(out, /- Blocks completed: \*\*2\/4\*\*/);
		assert.match(out, /- Current block: \*\*Block 3 — Title 3\*\*/);
		assert.match(out, /- Last completed evidence: Block 2 estimation checkpoint/);
		assert.match(out, /- \[x\] Block 1 — Title 1/);
		assert.match(out, /- \[ \] Block 3 — Title 3/);
		assert.match(out, /\*\*Latest Block 3 evidence:\*\* Coached application done; checkpoint pending\./);
		assert.match(out, /\*\*Next action:\*\*/);
	});

	it("lists LearnHarness sessions as plain text with date and title (no links)", () => {
		const withSession: CurriculumRecord = {
			...r,
			sessions: [{ chatId: "chat_1", objectiveId: "block-3", startedAt: "2026-10-27T12:00:00.000Z", title: "Block 3 session" }],
		};
		const out = renderProgressSection(withSession);
		assert.match(out, /LearnHarness session started for Block 3/);
		assert.match(out, /not completion evidence/);
		assert.ok(!out.includes("[["), "no wikilinks for LearnHarness ids");
	});

	it("is a pure function of the record (idempotent)", () => {
		assert.equal(renderProgressSection(r), renderProgressSection(r));
	});

	it("all completed: no current block", () => {
		const done = record([obj(1, { status: "completed" })]);
		assert.match(renderProgressSection(done), /Current block: \*\*none/);
	});
});

describe("spliceSubsection", () => {
	it("changes only the Progress update body; everything else is byte-identical", () => {
		const res = spliceSubsection(NOTE, "Progress update", "- NEW LINE");
		assert.ok(res.ok);
		if (!res.ok) return;
		const beforeIdx = NOTE.indexOf("### Progress update");
		const afterIdx = NOTE.indexOf("<!-- learning-agent:end -->");
		assert.equal(res.text.slice(0, beforeIdx + "### Progress update".length), NOTE.slice(0, beforeIdx + "### Progress update".length));
		assert.equal(res.text.slice(res.text.indexOf("<!-- learning-agent:end -->")), NOTE.slice(afterIdx));
		assert.ok(res.text.includes("- NEW LINE"));
		assert.ok(!res.text.includes("retrieve things"));
		assert.ok(res.text.includes("User paragraph outside the markers."));
		assert.ok(res.text.includes("**Current item:** Block 4"));
	});

	it("is idempotent", () => {
		const a = spliceSubsection(NOTE, "Progress update", "- X");
		assert.ok(a.ok);
		if (!a.ok) return;
		const b = spliceSubsection(a.text, "Progress update", "- X");
		assert.ok(b.ok);
		if (b.ok) assert.equal(b.text, a.text);
	});

	it("refuses when the markers are missing", () => {
		const res = spliceSubsection("### Progress update\n\nx\n", "Progress update", "y");
		assert.equal(res.ok, false);
	});

	it("refuses when the heading is missing inside the markers", () => {
		const res = spliceSubsection(NOTE.replace("### Progress update", "### Something else"), "Progress update", "y");
		assert.equal(res.ok, false);
	});

	it("ignores a same-named heading outside the markers", () => {
		const outside = "### Progress update\n\nuser text\n\n" + NOTE.replace("### Progress update", "### Other");
		assert.equal(spliceSubsection(outside, "Progress update", "y").ok, false);
	});
});

const REGISTRY = [
	"---",
	"type: learning-path",
	"---",
	"",
	"# Learning path: System Design",
	"",
	"## Curricula",
	"",
	"- title: X",
	"  file: \"/v/X.md\"",
	"",
	"## Progress",
	"",
	"- Last session: 2026-08-29 — `/v/Sessions/2026-08-29.md`",
	"- Current curriculum: X",
	"- Current item: Block 4",
	"- Notes: user notes that must stay.",
	"",
].join("\n");

describe("spliceRegistryProgress", () => {
	it("rewrites only the three managed bullets inside ## Progress", () => {
		const res = spliceRegistryProgress(REGISTRY, {
			lastSession: "2026-10-27 — `/v/Sessions/2026-10-27.md`",
			currentCurriculum: "X",
			currentItem: "Block 5 — Title 5",
		});
		assert.ok(res.ok);
		if (!res.ok) return;
		assert.ok(res.text.includes("- Last session: 2026-10-27 — `/v/Sessions/2026-10-27.md`"));
		assert.ok(res.text.includes("- Current item: Block 5 — Title 5"));
		assert.ok(res.text.includes("- Notes: user notes that must stay."));
		assert.equal(res.text.slice(0, res.text.indexOf("## Progress")), REGISTRY.slice(0, REGISTRY.indexOf("## Progress")));
	});

	it("leaves Last session untouched when none is supplied", () => {
		const res = spliceRegistryProgress(REGISTRY, { currentCurriculum: "X", currentItem: "Block 4" });
		assert.ok(res.ok);
		if (res.ok) assert.equal(res.text, REGISTRY);
	});

	it("refuses when ## Progress is missing", () => {
		assert.equal(spliceRegistryProgress("# x\n", { currentCurriculum: "X", currentItem: "Y" }).ok, false);
	});

	it("refuses when a managed bullet is missing", () => {
		const res = spliceRegistryProgress(REGISTRY.replace("- Current item: Block 4\n", ""), { currentCurriculum: "X", currentItem: "Y" });
		assert.equal(res.ok, false);
	});
});

// The real note's Progress update shape (copied structure, not read from the vault).
const STATIC_NOTE = [
	"<!-- learning-agent:start -->",
	"### Progress update",
	"",
	"- Blocks completed: **3/30**",
	"- Current block: **Block 4 — compute**",
	"- Last completed evidence: Block 3 checkpoint — [[2026-08-25|2026-08-25 session]]",
	"- Calendar deadline: **none**",
	"- Session maximum: **none**  ",
	"- Remediation/retake maximum: **none**",
	"",
	"- [x] Block 1 — A",
	"",
	"**Next action:** x.",
	"<!-- learning-agent:end -->",
	"",
].join("\n");

describe("static Progress lines are carried over, never deleted", () => {
	const r = record([obj(1, { status: "completed", statusNote: "ev1" }), obj(2, { status: "in-progress" })]);

	it("staticProgressLines captures the three lines verbatim, in order", () => {
		assert.deepEqual(staticProgressLines(STATIC_NOTE), [
			"- Calendar deadline: **none**",
			"- Session maximum: **none**  ",
			"- Remediation/retake maximum: **none**",
		]);
	});

	it("absent -> none captured, and nothing is written in their place", () => {
		assert.deepEqual(staticProgressLines(NOTE), []);
		const out = renderProgressSection(r, []);
		assert.ok(!/Calendar deadline|Session maximum|Remediation/.test(out));
		assert.equal(out, renderProgressSection(r));
	});

	it("rendered right after 'Last completed evidence', before the regenerated session/checklist lines", () => {
		const out = renderProgressSection(r, staticProgressLines(STATIC_NOTE)).split("\n");
		const i = out.findIndex((l) => l.startsWith("- Last completed evidence:"));
		assert.deepEqual(out.slice(i + 1, i + 4), staticProgressLines(STATIC_NOTE));
	});

	it("a splice round trip keeps them byte-for-byte and is idempotent", () => {
		const first = spliceSubsection(STATIC_NOTE, "Progress update", renderProgressSection(r, staticProgressLines(STATIC_NOTE)));
		assert.ok(first.ok);
		if (!first.ok) return;
		for (const line of staticProgressLines(STATIC_NOTE)) assert.ok(first.text.includes(`${line}\n`), line);
		const second = spliceSubsection(first.text, "Progress update", renderProgressSection(r, staticProgressLines(first.text)));
		assert.ok(second.ok);
		if (second.ok) assert.equal(second.text, first.text);
	});
});
