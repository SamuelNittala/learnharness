/**
 * Curriculum core — pure logic, browser-safe (no IO, no hashing; hashing
 * lives in the store/mirror adapters). Curriculum feature, Step 1.
 *
 *   validateCurriculumDraft   the importer's validate hook AND the review
 *                             form's inline problems (one source of truth)
 *   currentObjective          which objective "Continue" starts
 *   retrievalObjectives       the delayed-retrieval set (<= RETRIEVAL_CAP)
 *   curriculumContextText     the model-facing text of the session marker
 *   renderProgressSection     the Obsidian `### Progress update` body, in the
 *                             shape the note uses today
 *   spliceSubsection /        byte-preserving text splices for the mirror
 *   spliceRegistryProgress
 *
 * PEDAGOGY (learning-agent AGENTS.md): completion is gated by evidence,
 * never by attendance; a curriculum session opens with closed-note
 * retrieval of prior objectives before any new teaching.
 */

import type { CurriculumDraft, CurriculumObjective, CurriculumRecord } from "./contracts/curriculum.ts";

/** The most prior objectives a session's opening retrieval covers. */
export const RETRIEVAL_CAP = 3;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const blank = (s: string | undefined): boolean => s === undefined || s.trim().length === 0;

// ─── validation ──────────────────────────────────────────────────────────────

/** Every problem with a draft, human-readable; [] = valid. Checks: required
 *  strings, unique ids, prerequisites resolve, no dependency cycle,
 *  contiguous order from 1. */
export function validateCurriculumDraft(d: CurriculumDraft): string[] {
	const problems: string[] = [];
	if (blank(d.title)) problems.push("title is empty");
	if (!SLUG_RE.test(d.subjectSlug ?? "")) problems.push("subjectSlug must be lowercase kebab-case (e.g. system-design)");
	if (blank(d.progressUnit)) problems.push("progressUnit is empty");
	if (d.objectives.length === 0) {
		problems.push("a curriculum needs at least one objective");
		return problems;
	}
	const ids = new Set<string>();
	for (const o of d.objectives) {
		if (blank(o.id)) {
			problems.push(`objective #${o.order}: id is empty`);
			continue;
		}
		if (ids.has(o.id)) problems.push(`duplicate objective id ${o.id}`);
		ids.add(o.id);
	}
	for (const o of d.objectives) {
		const who = `objective ${o.id || `#${o.order}`}`;
		for (const field of ["title", "objective", "checkpoint", "evidenceCriterion"] as const) {
			if (blank(o[field])) problems.push(`${who}: ${field} is empty`);
		}
		if (!["not-started", "in-progress", "completed"].includes(o.status)) problems.push(`${who}: invalid status`);
		for (const p of o.prerequisites) {
			if (!ids.has(p)) problems.push(`${who}: unknown prerequisite ${p}`);
		}
	}
	const orders = d.objectives.map((o) => o.order).sort((a, b) => a - b);
	if (!orders.every((n, i) => n === i + 1)) problems.push("objective order must be contiguous from 1");
	if (hasCycle(d.objectives)) problems.push("prerequisites contain a dependency cycle");
	return problems;
}

function hasCycle(objectives: readonly CurriculumObjective[]): boolean {
	const prereqs = new Map(objectives.map((o) => [o.id, o.prerequisites]));
	const state = new Map<string, 1 | 2>(); // 1 = on the stack, 2 = done
	const visit = (id: string): boolean => {
		if (state.get(id) === 2) return false;
		if (state.get(id) === 1) return true;
		state.set(id, 1);
		for (const p of prereqs.get(id) ?? []) if (prereqs.has(p) && visit(p)) return true;
		state.set(id, 2);
		return false;
	};
	return objectives.some((o) => visit(o.id));
}

// ─── selection ───────────────────────────────────────────────────────────────

type Objectives = Pick<CurriculumRecord, "objectives">;

const byOrder = (a: CurriculumObjective, b: CurriculumObjective): number => a.order - b.order;

/** The objective "Continue" starts: among objectives that are not completed
 *  and whose prerequisites are all completed (order follows prerequisites,
 *  not strict sequence), an in-progress one resumes first, else the lowest
 *  order. null = nothing left. */
export function currentObjective(r: Objectives): CurriculumObjective | null {
	const done = new Set(r.objectives.filter((o) => o.status === "completed").map((o) => o.id));
	const eligible = r.objectives
		.filter((o) => o.status !== "completed" && o.prerequisites.every((p) => done.has(p)))
		.sort(byOrder);
	return eligible.find((o) => o.status === "in-progress") ?? eligible[0] ?? null;
}

/** The delayed-retrieval set for a session on `current`: its COMPLETED
 *  direct prerequisites plus the most recently completed objective (highest
 *  order — the record carries no completion timestamps), capped at
 *  RETRIEVAL_CAP. When over the cap the most recent is kept and the
 *  remaining slots go to the prerequisites closest in order. Returned in
 *  prerequisite order (prerequisites before their dependents). */
export function retrievalObjectives(r: Objectives, current: CurriculumObjective): CurriculumObjective[] {
	const completed = r.objectives.filter((o) => o.status === "completed" && o.id !== current.id);
	const direct = completed.filter((o) => current.prerequisites.includes(o.id));
	const recent = [...completed].sort(byOrder).at(-1);
	const picked = new Map<string, CurriculumObjective>();
	if (recent) picked.set(recent.id, recent);
	for (const o of [...direct].sort((a, b) => b.order - a.order)) {
		if (picked.size >= RETRIEVAL_CAP) break;
		picked.set(o.id, o);
	}
	return topoOrder([...picked.values()]);
}

/** Prerequisites first, lowest order breaking ties. */
function topoOrder(set: CurriculumObjective[]): CurriculumObjective[] {
	const remaining = [...set].sort(byOrder);
	const placed = new Set<string>();
	const inSet = new Set(remaining.map((o) => o.id));
	const out: CurriculumObjective[] = [];
	while (remaining.length > 0) {
		const i = remaining.findIndex((o) => o.prerequisites.every((p) => !inSet.has(p) || placed.has(p)));
		const [next] = remaining.splice(i < 0 ? 0 : i, 1);
		placed.add(next!.id);
		out.push(next!);
	}
	return out;
}

// ─── labels + model-facing text ──────────────────────────────────────────────

const capitalize = (s: string): string => (s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1));

/** "Block 4 — Compute, load balancing, cache, and CDN". */
export function objectiveLabel(r: Pick<CurriculumRecord, "progressUnit">, o: CurriculumObjective): string {
	return `${capitalize(r.progressUnit)} ${o.order} — ${o.title}`;
}

/** The fixed opening user prompt a Continue session starts with. */
export function curriculumOpeningPrompt(r: Pick<CurriculumRecord, "progressUnit">, o: CurriculumObjective): string {
	return `Continue: ${objectiveLabel(r, o)}`;
}

/** The curriculum-context marker's model-facing text. PREAMBLE LAW
 *  (native-messages.ts): markers flatten to user-role messages, so this
 *  opens with the bracket convention, not a system broadcast. The behavior
 *  it triggers lives in the prober/teacher prompt fragments. */
export function curriculumContextText(
	r: Pick<CurriculumRecord, "title" | "progressUnit">,
	current: CurriculumObjective,
	retrieval: readonly CurriculumObjective[],
): string {
	const lines = [
		"[Curriculum context] — this session continues the learner's curriculum:",
		"",
		`Curriculum: ${r.title}`,
		`Objective [${current.id}] ${objectiveLabel(r, current)}`,
		`Measurable objective: ${current.objective}`,
		`Checkpoint: ${current.checkpoint}`,
		`Evidence criterion (completion is decided outside this session, from evidence — attendance and in-session coached success never complete it): ${current.evidenceCriterion}`,
	];
	if (current.cumulative) lines.push("This objective is cumulative: it revisits earlier objectives in changed contexts.");
	if (current.statusNote) lines.push(`Recorded so far: ${current.statusNote}`);
	lines.push("");
	if (retrieval.length === 0) {
		lines.push("No prior objectives are completed yet, so there is nothing to retrieve before new teaching.");
	} else {
		lines.push(
			"Prior objectives to retrieve closed-note (no hints, no sources, no teaching) before any new teaching:",
			...retrieval.map((o) => `- [${o.id}] ${objectiveLabel(r, o)} — evidence: ${o.evidenceCriterion}`),
		);
	}
	return lines.join("\n");
}

// ─── the Obsidian progress section ───────────────────────────────────────────

/** Local calendar date (YYYY-MM-DD) of an ISO timestamp. */
export function localDate(iso: string): string {
	const d = new Date(iso);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The `### Progress update` body (no heading), in the shape the note uses
 *  today: counts, current block, last completed evidence, the checklist,
 *  latest evidence, next action. LearnHarness sessions appear as plain text
 *  (their ids cannot be opened from Obsidian). A pure function of the
 *  record (plus `carried`) — re-rendering an unchanged record yields
 *  identical text. */
export function renderProgressSection(r: CurriculumRecord, carried: readonly string[] = []): string {
	const completed = r.objectives.filter((o) => o.status === "completed").sort(byOrder);
	const current = currentObjective(r);
	const lastDone = [...completed].reverse().find((o) => !blank(o.statusNote));
	const lines = [
		`- ${capitalize(r.progressUnit)}s completed: **${completed.length}/${r.objectives.length}**`,
		`- Current ${r.progressUnit}: **${current ? objectiveLabel(r, current) : "none — all completed"}**`,
		`- Last completed evidence: ${lastDone?.statusNote ?? "none recorded"}`,
		// The note's static lines (see staticProgressLines), carried verbatim.
		...carried,
	];
	for (const s of r.sessions) {
		const o = r.objectives.find((x) => x.id === s.objectiveId);
		const label = o ? objectiveLabel(r, o) : s.objectiveId;
		lines.push(`- LearnHarness session started for ${label} — ${localDate(s.startedAt)}${s.title ? ` — ${s.title}` : ""} (not completion evidence)`);
	}
	lines.push("");
	for (const o of [...r.objectives].sort(byOrder)) {
		lines.push(`- [${o.status === "completed" ? "x" : " "}] ${objectiveLabel(r, o)}`);
	}
	if (current && !blank(current.statusNote)) {
		lines.push("", `**Latest ${capitalize(r.progressUnit)} ${current.order} evidence:** ${current.statusNote}`);
	}
	if (current) {
		const prior = retrievalObjectives(r, current);
		const retrieve = prior.length > 0 ? `retrieve ${prior.map((o) => `${capitalize(r.progressUnit)} ${o.order}`).join(", ")} closed-note before new teaching, then ` : "";
		lines.push("", `**Next action:** ${retrieve}work toward the evidence criterion: ${current.evidenceCriterion}`);
	} else {
		lines.push("", "**Next action:** all objectives are completed.");
	}
	return lines.join("\n");
}

// ─── byte-preserving splices ─────────────────────────────────────────────────

export type SpliceResult = { ok: true; text: string } | { ok: false; error: string };

export const MANAGED_START = "<!-- learning-agent:start -->";
export const MANAGED_END = "<!-- learning-agent:end -->";

/** Replace ONLY the body of `### <heading>` inside the learning-agent
 *  managed block. The body runs from the heading line to the next heading
 *  (level 1-3) or the end marker; its trailing whitespace is kept so the
 *  surrounding layout stays byte-stable. Refuses (never appends) when the
 *  markers or the heading are missing. */
export function spliceSubsection(noteText: string, heading: string, body: string): SpliceResult {
	const loc = locateSubsection(noteText, heading);
	if (!loc.ok) return loc;
	const trailing = /\s*$/.exec(loc.oldBody)![0] || "\n";
	return { ok: true, text: `${noteText.slice(0, loc.bodyStart)}\n${body.trimEnd()}${trailing}${noteText.slice(loc.bodyEnd)}` };
}

/** Where a `### <heading>` body sits inside the managed block (absolute
 *  offsets into `noteText`). */
function locateSubsection(
	noteText: string,
	heading: string,
): { ok: true; bodyStart: number; bodyEnd: number; oldBody: string } | { ok: false; error: string } {
	const start = noteText.indexOf(MANAGED_START);
	const end = start < 0 ? -1 : noteText.indexOf(MANAGED_END, start + MANAGED_START.length);
	if (start < 0 || end < 0) return { ok: false, error: "learning-agent markers not found in the note" };
	const regionStart = start + MANAGED_START.length;
	const region = noteText.slice(regionStart, end);
	const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const headingRe = new RegExp(`^### ${escaped}[ \\t]*(?:\\r?\\n|$)`, "m");
	const hit = headingRe.exec(region);
	if (!hit) return { ok: false, error: `heading "### ${heading}" not found inside the managed block` };
	const bodyStart = hit.index + hit[0].length;
	const next = /^#{1,3} /m.exec(region.slice(bodyStart));
	const bodyEnd = next ? bodyStart + next.index : region.length;
	return { ok: true, bodyStart: regionStart + bodyStart, bodyEnd: regionStart + bodyEnd, oldBody: region.slice(bodyStart, bodyEnd) };
}

const STATIC_PROGRESS_PREFIXES = ["- Calendar deadline:", "- Session maximum:", "- Remediation/retake maximum:"];

/** The note's static Progress update lines (calendar deadline, session
 *  maximum, remediation/retake maximum), verbatim and in note order, so the
 *  mirror can carry them over unchanged instead of deleting them. [] when
 *  the note lacks the section or the lines. */
export function staticProgressLines(noteText: string): string[] {
	const loc = locateSubsection(noteText, "Progress update");
	if (!loc.ok) return [];
	return loc.oldBody.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => STATIC_PROGRESS_PREFIXES.some((p) => l.startsWith(p)));
}

export interface RegistryProgressFields {
	/** Left untouched when undefined. */
	lastSession?: string;
	currentCurriculum: string;
	currentItem: string;
}

/** Rewrite ONLY the managed bullets (`- Last session:`, `- Current
 *  curriculum:`, `- Current item:`) inside the registry's `## Progress`
 *  section; every other line (YAML, `## Curricula`, `- Notes:`) is kept.
 *  Refuses when the section or a managed bullet is missing. */
export function spliceRegistryProgress(indexText: string, fields: RegistryProgressFields): SpliceResult {
	const hit = /^## Progress[ \t]*$/m.exec(indexText);
	if (!hit) return { ok: false, error: 'registry has no "## Progress" section' };
	const sectionStart = hit.index + hit[0].length;
	const next = /^## /m.exec(indexText.slice(sectionStart));
	const sectionEnd = next ? sectionStart + next.index : indexText.length;
	const lines = indexText.slice(sectionStart, sectionEnd).split("\n");
	const wanted: Array<[string, string | undefined]> = [
		["- Last session:", fields.lastSession],
		["- Current curriculum:", fields.currentCurriculum],
		["- Current item:", fields.currentItem],
	];
	for (const [prefix, value] of wanted) {
		if (value === undefined) continue;
		const i = lines.findIndex((l) => l.startsWith(prefix));
		if (i < 0) return { ok: false, error: `registry "## Progress" has no "${prefix}" line` };
		lines[i] = `${prefix} ${value}`;
	}
	return { ok: true, text: indexText.slice(0, sectionStart) + lines.join("\n") + indexText.slice(sectionEnd) };
}
