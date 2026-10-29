import React from "react";
(globalThis as Record<string, unknown>).React = React;

import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CurriculumDraft, CurriculumObjective, CurriculumRecord } from "../src/core/contracts.ts";
import { CurriculumReview, moveObjective } from "../components/curriculum-import.tsx";
import { CurriculumViewBody, groupByPhase, startCurriculumSession } from "../components/curriculum-view.tsx";
import { CurriculumContextCard } from "../components/curriculum-context-card.tsx";

const obj = (order: number, over: Partial<CurriculumObjective> = {}): CurriculumObjective => ({
	id: `block-${order}`,
	order,
	phase: order <= 2 ? "Phase 1" : "Phase 2",
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

const objectives = [obj(1, { status: "completed" }), obj(2, { status: "in-progress" }), obj(3), obj(4, { cumulative: true })];

const draft: CurriculumDraft = {
	title: "System Design",
	aliases: ["sd"],
	subjectSlug: "system-design",
	progressUnit: "block",
	outcomes: [],
	objectives,
	source: { kind: "obsidian", notePath: "/v/C.md", rawMarkdown: "raw", importedAt: "t" },
};
const record: CurriculumRecord = { ...draft, id: "cur_1", createdAt: "t", updatedAt: "t", sessions: [] };

describe("CurriculumReview", () => {
	it("a valid draft: no problems, Save enabled", () => {
		const html = renderToStaticMarkup(<CurriculumReview draft={draft} onChange={() => {}} onSave={() => {}} />);
		assert.ok(!html.includes("review-problems"));
		const at = html.indexOf('data-testid="review-save"');
		assert.ok(!html.slice(at - 120, at + 120).includes('disabled=""'), "Save is enabled");
	});

	it("an invalid draft shows the validation problems inline and disables Save", () => {
		const bad: CurriculumDraft = { ...draft, objectives: [obj(1, { evidenceCriterion: "" }), obj(2, { prerequisites: ["block-9"] })] };
		const html = renderToStaticMarkup(<CurriculumReview draft={bad} onChange={() => {}} onSave={() => {}} />);
		assert.ok(html.includes('data-testid="review-problems"'));
		assert.ok(html.includes("evidenceCriterion is empty"));
		assert.ok(html.includes("unknown prerequisite block-9"));
		const save = html.slice(html.indexOf('data-testid="review-save"') - 120, html.indexOf('data-testid="review-save"') + 200);
		assert.ok(save.includes('disabled=""'));
	});

	it("moveObjective swaps neighbours and renumbers order; out of range is a no-op", () => {
		const moved = moveObjective(draft, 1, -1);
		assert.deepEqual(moved.objectives.map((o) => [o.id, o.order]), [["block-2", 1], ["block-1", 2], ["block-3", 3], ["block-4", 4]]);
		assert.equal(moveObjective(draft, 0, -1), draft);
		assert.equal(moveObjective(draft, 3, 1), draft);
	});
});

describe("CurriculumViewBody", () => {
	it("groups objectives by phase, marks the current one, and shows status chips", () => {
		const html = renderToStaticMarkup(<CurriculumViewBody curriculum={record} onContinue={() => {}} />);
		assert.ok(html.includes('data-testid="phase-Phase 1"'));
		assert.ok(html.includes('data-testid="phase-Phase 2"'));
		assert.match(html, /data-testid="objective-block-2" data-current="true"/);
		assert.match(html, /data-testid="objective-block-1" data-current="false"/);
		assert.ok(html.includes("completed") && html.includes("in-progress") && html.includes("not-started"));
		assert.ok(html.includes("1/4 blocks completed"));
		assert.ok(html.includes("Continue — Block 2 — T2"));
	});

	it("everything completed: Continue is disabled", () => {
		const done = { ...record, objectives: objectives.map((o) => ({ ...o, status: "completed" as const })) };
		const html = renderToStaticMarkup(<CurriculumViewBody curriculum={done} onContinue={() => {}} />);
		const at = html.indexOf('data-testid="curriculum-continue"');
		assert.ok(html.slice(at - 200, at + 200).includes('disabled=""'));
	});

	it("groupByPhase keeps first-seen phase order", () => {
		assert.deepEqual(groupByPhase(objectives).map((g) => g.phase), ["Phase 1", "Phase 2"]);
	});
});

describe("startCurriculumSession — Continue posts only the curriculumId", () => {
	it("posts {curriculum:{curriculumId}} and returns the prompt redirect", async () => {
		const calls: { url: string; body: unknown }[] = [];
		const f = (async (url: string, init?: RequestInit) => {
			calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
			return new Response(JSON.stringify({ id: "c_9", title: "t", prompt: "Continue: Block 2 — T2" }), { status: 200 });
		}) as typeof fetch;
		const target = await startCurriculumSession("cur_1", f);
		assert.deepEqual(calls, [{ url: "/api/chats", body: { curriculum: { curriculumId: "cur_1" } } }]);
		assert.equal(target, "/chat/c_9?prompt=Continue%3A%20Block%202%20%E2%80%94%20T2");
	});

	it("surfaces the server's refusal message", async () => {
		const f = (async () => new Response(JSON.stringify({ error: "Unknown curriculum" }), { status: 400 })) as typeof fetch;
		await assert.rejects(() => startCurriculumSession("nope", f), /Unknown curriculum/);
	});
});

describe("CurriculumContextCard", () => {
	const data = {
		curriculumId: "cur_1",
		title: "System Design",
		objective: { id: "block-2", label: "Block 2 — T2", evidenceCriterion: "E2", cumulative: true },
		retrieval: [{ id: "block-1", label: "Block 1 — T1" }],
	};
	it("renders collapsed with the objective label", () => {
		const html = renderToStaticMarkup(<CurriculumContextCard data={data} />);
		assert.ok(html.includes('data-testid="curriculum-context-card"'));
		assert.ok(html.includes("Block 2 — T2"));
		assert.ok(!html.includes("curriculum-context-body"));
	});
});
