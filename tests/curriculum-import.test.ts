/**
 * THE CURRICULUM IMPORTER (curriculum feature, Step 1): one submit call turns
 * the free-form note into a structured draft. Fake (faux) engines only — no
 * network, no LLM. The system prompt is injected by the tests.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, type FauxResponseStep, type ToolCall } from "@earendil-works/pi-ai";
import type { PiEngine } from "../src/agent/models.ts";
import { CURRICULUM_IMPORT_PROMPT, extractCurriculum } from "../src/agent/subagents/curriculum-import.ts";
import { ModelsNotConfiguredError } from "../src/core/settings.ts";

function fauxEngine(steps: FauxResponseStep[]): PiEngine {
	const faux = createFauxCore({});
	faux.setResponses(steps);
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}

const call = (input: unknown, id: string): FauxResponseStep => () =>
	fauxAssistantMessage([fauxToolCall("submit_curriculum", input as ToolCall["arguments"], { id })], { stopReason: "toolUse" });

const objective = (order: number, over: Record<string, unknown> = {}) => ({
	id: `block-${order}`,
	order,
	title: `Title ${order}`,
	objective: `Objective ${order}`,
	prerequisites: order > 1 ? [`block-${order - 1}`] : [],
	checkpoint: `Checkpoint ${order}`,
	evidenceCriterion: `Evidence ${order}`,
	...over,
});

const GOOD = {
	title: "System Design",
	subjectSlug: "system-design",
	progressUnit: "block",
	objectives: [objective(1, { status: "completed" }), objective(2, { status: "in-progress", cumulative: true })],
};

const MARKDOWN = "---\ntitle: System Design\n---\n\n# Curriculum\r\n| Block | ... |\n";
const args = (engine: PiEngine | undefined) => ({
	engine,
	notePath: "/vault/System Design/Curriculum.md",
	markdown: MARKDOWN,
	systemPrompt: "STUB IMPORT PROMPT",
	signal: undefined,
});

describe("extractCurriculum", () => {
	it("the live importer prompt is wired", () => {
		assert.ok(CURRICULUM_IMPORT_PROMPT.startsWith("You are the importer for a learning application's curriculum feature."));
		assert.ok(CURRICULUM_IMPORT_PROMPT.includes("`learning-path`"));
	});

	it("a valid submit becomes a draft whose rawMarkdown is the input verbatim", async () => {
		const draft = await extractCurriculum(args(fauxEngine([call(GOOD, "ok")])));
		assert.equal(draft.source.rawMarkdown, MARKDOWN);
		assert.equal(draft.source.notePath, "/vault/System Design/Curriculum.md");
		assert.equal(draft.source.kind, "obsidian");
		assert.ok(!Number.isNaN(Date.parse(draft.source.importedAt)));
		assert.equal(draft.title, "System Design");
		assert.equal(draft.objectives.length, 2);
		// fill defaults: absent optional arrays/flags become empty/false
		assert.deepEqual(draft.aliases, []);
		assert.deepEqual(draft.objectives[0]!.activities, []);
		assert.equal(draft.objectives[0]!.cumulative, false);
		assert.equal(draft.objectives[1]!.status, "in-progress");
		assert.equal(draft.objectives[1]!.cumulative, true);
	});

	it("a cyclic-prerequisite submit is a tool error, then the corrected retry is accepted", async () => {
		const cyclic = {
			...GOOD,
			objectives: [objective(1, { prerequisites: ["block-2"] }), objective(2, { prerequisites: ["block-1"] })],
		};
		const draft = await extractCurriculum(args(fauxEngine([call(cyclic, "bad"), call(GOOD, "good")])));
		assert.equal(draft.objectives[0]!.prerequisites.length, 0);
		assert.equal(draft.objectives.length, 2);
	});

	it("a stringified objectives array is healed, not punished", async () => {
		const stringified = { ...GOOD, objectives: JSON.stringify(GOOD.objectives) };
		const draft = await extractCurriculum(args(fauxEngine([call(stringified, "str")])));
		assert.equal(draft.objectives.length, 2);
	});

	it("no engine -> the typed models-not-configured refusal (strong tier)", async () => {
		await assert.rejects(
			() => extractCurriculum(args(undefined)),
			(err: unknown) => err instanceof ModelsNotConfiguredError && err.envelope.missing.includes("strong"),
		);
	});

	it("a model that never submits throws", async () => {
		const silent = fauxEngine([fauxAssistantMessage("no tools"), fauxAssistantMessage("still none")]);
		await assert.rejects(() => extractCurriculum(args(silent)), /never submitted/);
	});
});
