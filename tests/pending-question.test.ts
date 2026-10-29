/**
 * THE CLIENT PENDING-QUESTION GATE matches its native twin
 * (danglingQuestionOf, src/core/native-messages.ts): only the NEWEST
 * assistant message can hold the pending question. A question the learner
 * superseded by typing instead of answering (e.g. "Accept the plan?"
 * followed by a composer message) must not resurface in the dock later —
 * the server would refuse its answer with "answer input targets no pending
 * question call".
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findPendingToolCall } from "../src/core/pending.ts";

type UIMessage = Parameters<typeof findPendingToolCall>[0][number];

const ask = (id: string, state: string): UIMessage =>
	({ id: `m_${id}`, role: "assistant", parts: [{ type: "tool-ask_user_question", toolCallId: id, state, input: { question: "Accept the plan?" } }] }) as unknown as UIMessage;
const quiz = (id: string, state: string): UIMessage =>
	({ id: `m_${id}`, role: "assistant", parts: [{ type: "tool-quiz", toolCallId: id, state, input: {} }] }) as unknown as UIMessage;
const user = (text: string): UIMessage => ({ id: `u_${text}`, role: "user", parts: [{ type: "text", text }] }) as unknown as UIMessage;
const said = (text: string): UIMessage => ({ id: `a_${text}`, role: "assistant", parts: [{ type: "text", text }] }) as unknown as UIMessage;

describe("findPendingToolCall", () => {
	it("returns the newest assistant message's unanswered question", () => {
		const p = findPendingToolCall([user("hi"), quiz("q1", "input-available")]);
		assert.equal(p?.toolCallId, "q1");
	});

	it("ignores a superseded question when a newer assistant message has none", () => {
		const messages = [
			ask("plan", "input-available"),
			user("start the teaching phase"),
			quiz("q1", "output-available"),
			said("The provider is the external SMS service."),
		];
		assert.equal(findPendingToolCall(messages), null);
	});

	it("ignores a superseded question when the newest one is answered", () => {
		const messages = [ask("plan", "input-available"), user("go"), quiz("q1", "output-available")];
		assert.equal(findPendingToolCall(messages), null);
	});

	it("skips trailing non-assistant messages to reach the newest assistant message", () => {
		const p = findPendingToolCall([quiz("q1", "input-available"), user("thinking aloud")]);
		assert.equal(p?.toolCallId, "q1");
	});
});
