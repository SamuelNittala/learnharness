/**
 * The curriculum importer (curriculum feature, Step 1): ONE submit call turns
 * a free-form Obsidian curriculum note into a structured CurriculumDraft.
 * Same single-submit seam as the notes extractor (runSubmitAgent): a TypeBox
 * schema, a semantic `validate` (unique ids, prerequisites resolve, no
 * cycles — core/curriculum.ts, the SAME function the review form uses), and
 * the weak-model array heal. The raw markdown rides into the draft verbatim
 * (re-extraction material); notePath/registry/sessions paths are not the
 * model's business.
 *
 * The system prompt is CURRICULUM_IMPORT_PROMPT (an inline constant, like
 * the other subagents); callers pass it as `systemPrompt`.
 *
 * The agent layer never imports server/store: the engine arrives as an
 * argument (the seam resolves it).
 */

import type { Usage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { PiEngine } from "../models.ts";
import { ModelsNotConfiguredError } from "../../core/settings.ts";
import { validateCurriculumDraft } from "../../core/curriculum.ts";
import type { CurriculumDraft, CurriculumObjective } from "../../core/contracts.ts";
import { healStringifiedArrays, runSubmitAgent } from "./submit-agent.ts";

/** The importer system prompt (owner-approved wording). */
export const CURRICULUM_IMPORT_PROMPT = `You are the importer for a learning application's curriculum feature. The user message is a curriculum written as a free-form Obsidian note: YAML front matter, then a plan with sections, tables of numbered units (often called blocks), and a progress record. Your job is to read it and report its structure in ONE submit_curriculum call. You do not teach, summarize, improve, or reorder anything.

FAITHFULNESS comes first. Take every value from the note; never invent an objective, evidence requirement, prerequisite, or progress status the note does not state. Keep the note's own wording for objectives, checkpoints and evidence. If a required field is genuinely absent for a unit, reuse the nearest text the note gives for that unit (for example, its checkpoint as its evidence criterion) rather than writing new content.

Fields:
- title, aliases: from the YAML front matter (\`title\`, \`aliases\`).
- subjectSlug: the front matter's \`learning-path\` value if present, otherwise the title in lowercase kebab-case.
- progressUnit: the front matter's \`progress-unit\` value (singular, lowercase, e.g. "block").
- outcomes: the note's stated target or learning outcomes, one string each.
- objectives: one entry per numbered unit, in the note's order.
  - id: the progress unit and its number, lowercase, e.g. "block-4". order: its number, contiguous from 1.
  - phase: the heading or phase label the unit sits under, if any.
  - title: the unit's short title. objective: its measurable objective, in the note's words.
  - prerequisites: ids of the units it depends on. Read these from the note's prerequisite statements ("Prerequisite: Blocks 3–4" means block-3 and block-4; expand ranges) and its dependency order. Only units that exist in the note; never a unit after it.
  - activities: its ordered required activities, one string each.
  - checkpoint: the note's checkpoint for the unit.
  - evidenceCriterion: what must be demonstrated to complete it — the note's checkpoint together with its evidence requirement, in the note's words. Attendance or finishing a session is never evidence.
  - cumulative: true only for units the note describes as mocks or as revisiting earlier units in new contexts.
  - status: take it ONLY from the note's explicit progress record (a checked item is "completed"; the unit named as the current item is "in-progress"). Everything else is "not-started". Never infer progress from prose elsewhere.
  - statusNote: the evidence the note records for that unit, verbatim, when it records any.

Submit exactly once. If the submission is rejected for a problem (duplicate id, unknown prerequisite, a dependency cycle), fix that problem and submit again.`;

const objectiveSchema = Type.Object({
	id: Type.String({ description: 'Stable id, e.g. "block-4" (the progress unit + its number).' }),
	order: Type.Integer({ description: "1-based position; contiguous across the curriculum." }),
	phase: Type.Optional(Type.String({ description: "Grouping label (e.g. the note's phase heading), if any." })),
	title: Type.String({ description: "Short objective title." }),
	objective: Type.String({ description: "The measurable objective, in the note's words." }),
	prerequisites: Type.Optional(Type.Array(Type.String(), { description: "Ids of objectives that must be completed first." })),
	activities: Type.Optional(Type.Array(Type.String(), { description: "The ordered required activities." })),
	checkpoint: Type.String({ description: "The note's checkpoint for this objective." }),
	evidenceCriterion: Type.String({ description: "What evidence completes this objective (checkpoint + evidence)." }),
	cumulative: Type.Optional(Type.Boolean({ description: "True for objectives that revisit earlier ones (mock blocks)." })),
	status: Type.Optional(
		Type.Union([Type.Literal("not-started"), Type.Literal("in-progress"), Type.Literal("completed")], {
			description: "Only from the note's explicit progress record; default not-started.",
		}),
	),
	statusNote: Type.Optional(Type.String({ description: "The note's recorded evidence for this objective, if any." })),
});

const curriculumSchema = Type.Object({
	title: Type.String({ description: "The curriculum title." }),
	aliases: Type.Optional(Type.Array(Type.String())),
	subjectSlug: Type.String({ description: "Lowercase kebab-case subject (the registry directory name)." }),
	progressUnit: Type.String({ description: 'The note\'s progress unit, singular lowercase (e.g. "block").' }),
	outcomes: Type.Optional(Type.Array(Type.String(), { description: "The curriculum's target outcomes." })),
	objectives: Type.Array(objectiveSchema, { description: "Every objective, in order." }),
});

interface Submitted {
	title: string;
	aliases?: string[];
	subjectSlug: string;
	progressUnit: string;
	outcomes?: string[];
	objectives: Array<Partial<CurriculumObjective> & Pick<CurriculumObjective, "id" | "order" | "title" | "objective" | "checkpoint" | "evidenceCriterion">>;
}

export interface ExtractCurriculumArgs {
	/** undefined = the BYOK chain came up empty -> typed refusal. */
	engine: PiEngine | undefined;
	notePath: string;
	markdown: string;
	/** The importer system prompt (the seam passes CURRICULUM_IMPORT_PROMPT). */
	systemPrompt: string;
	signal?: AbortSignal;
	onStep?: (usage: Usage, model: string, step: number, finishReason: string, tools: string) => void;
}

export async function extractCurriculum(args: ExtractCurriculumArgs): Promise<CurriculumDraft> {
	if (!args.engine) throw new ModelsNotConfiguredError(["strong"]);
	const importedAt = new Date().toISOString();
	const fill = (input: Submitted): CurriculumDraft => ({
		title: input.title,
		aliases: input.aliases ?? [],
		subjectSlug: input.subjectSlug,
		progressUnit: input.progressUnit,
		outcomes: input.outcomes ?? [],
		objectives: input.objectives.map((o) => ({
			id: o.id,
			order: o.order,
			...(o.phase !== undefined ? { phase: o.phase } : {}),
			title: o.title,
			objective: o.objective,
			prerequisites: o.prerequisites ?? [],
			activities: o.activities ?? [],
			checkpoint: o.checkpoint,
			evidenceCriterion: o.evidenceCriterion,
			cumulative: o.cumulative ?? false,
			status: o.status ?? "not-started",
			...(o.statusNote !== undefined ? { statusNote: o.statusNote } : {}),
		})),
		// The raw markdown rides verbatim; the model never touches it.
		source: { kind: "obsidian", notePath: args.notePath, rawMarkdown: args.markdown, importedAt },
	});
	return runSubmitAgent<CurriculumDraft>({
		role: "curriculumImporter",
		toolName: "submit_curriculum",
		toolDescription: "Submit the structured curriculum.",
		parameters: curriculumSchema,
		fill,
		validate: (draft) => {
			const problems = validateCurriculumDraft(draft);
			return problems.length > 0 ? problems.join("; ") : null;
		},
		systemPrompt: args.systemPrompt,
		prompt: `Curriculum note (${args.notePath}):\n\n${args.markdown}`,
		engine: args.engine,
		signal: args.signal,
		onStep: args.onStep ?? (() => {}),
		neverSubmitted: "the curriculum importer never submitted a curriculum",
		prepareArguments: healStringifiedArrays,
	});
}
