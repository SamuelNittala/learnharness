/**
 * THE CURRICULUM-CONTEXT MARKER (curriculum feature, Step 1): a session
 * started from a curriculum gets a SEPARATE custom message BEFORE the
 * learner's first user message (the graph-context precedent). The model
 * reads its content; `details` feeds the transcript card.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CurriculumObjective, CurriculumRecord } from "../src/core/contracts.ts";
import { newCurriculumContextMessage, nativeInputCause, toLlmMessages, type LhMessage } from "../src/core/native-messages.ts";
import { projectView } from "../src/core/view.ts";
import { initialPromptOwed } from "../components/chat.tsx";

const obj = (order: number, over: Partial<CurriculumObjective> = {}): CurriculumObjective => ({
	id: `block-${order}`,
	order,
	title: `T${order}`,
	objective: `O${order}`,
	prerequisites: [],
	activities: [],
	checkpoint: "c",
	evidenceCriterion: `E${order}`,
	cumulative: order === 2,
	status: "not-started",
	...over,
});
const objectives = [obj(1, { status: "completed" }), obj(2, { status: "in-progress" })];
const record = { id: "cur_x", title: "System Design", progressUnit: "block", objectives } as unknown as CurriculumRecord;

describe("newCurriculumContextMessage", () => {
	const m = newCurriculumContextMessage(record, objectives[1]!, [objectives[0]!]);

	it("is a display custom marker whose content opens with [Curriculum context]", () => {
		assert.equal(m.role, "custom");
		assert.equal(m.customType, "curriculum-context");
		assert.equal(m.display, true);
		assert.ok(m.content.startsWith("[Curriculum context]"));
		assert.ok(m.content.includes("E2"));
	});

	it("details is the structured card payload, not the flattened text", () => {
		assert.deepEqual(m.details, {
			curriculumId: "cur_x",
			title: "System Design",
			objective: { id: "block-2", label: "Block 2 — T2", evidenceCriterion: "E2", cumulative: true },
			retrieval: [{ id: "block-1", label: "Block 1 — T1" }],
		});
	});

	it("toLlmMessages flattens it to a user message with that content", () => {
		const wire = toLlmMessages([m as unknown as LhMessage] as never);
		assert.equal(wire.length, 1);
		assert.equal(wire[0]!.role, "user");
		assert.ok(String((wire[0]!.content as { text?: string }[])[0]!.text).startsWith("[Curriculum context]"));
	});

	it("projectView yields a user-side data-curriculum-context part, never a text bubble", () => {
		const view = projectView([m as unknown as LhMessage] as never);
		assert.equal(view.length, 1);
		assert.equal(view[0]!.role, "user");
		const part = view[0]!.parts[0] as { type: string; data: unknown };
		assert.equal(part.type, "data-curriculum-context");
		assert.deepEqual(part.data, m.details);
		assert.equal(view[0]!.parts.length, 1);
	});

	it("nativeInputCause is neutral (scaffolding confers no input cause)", () => {
		assert.equal(nativeInputCause(m as never, []), "neutral");
	});

	it("a marker-only record still owes the first prompt", () => {
		assert.equal(initialPromptOwed([m as never], "Continue: Block 2 — T2"), true);
	});
});
