/**
 * Curriculum contracts — the time-bounded learning path imported from an
 * Obsidian note (curriculum feature, Step 1; plan:
 * ~/.claude/plans/learnharness-curriculum-import.md).
 *
 * LearnHarness JSON (data/curricula/<id>.json) is the SOURCE OF TRUTH; the
 * Obsidian note + registry index are a one-way MIRROR of progress
 * (src/store/obsidian-mirror.ts). Pure types + the schema stamp, no logic.
 */

export type ObjectiveStatus = "not-started" | "in-progress" | "completed";

/** One ordered objective (the source note calls it a block). The id is
 *  stable ("block-4"); prerequisites reference other objective ids. */
export interface CurriculumObjective {
	id: string;
	/** 1-based position, contiguous across the curriculum. */
	order: number;
	/** Grouping label (e.g. "Phase 2 — Data"), optional. */
	phase?: string;
	title: string;
	/** The measurable objective, in the note's words. */
	objective: string;
	/** Objective ids that must be completed first. */
	prerequisites: string[];
	activities: string[];
	/** The note's "Checkpoint" column. */
	checkpoint: string;
	/** What evidence completes this objective (the note's "Checkpoint" +
	 *  "Evidence" columns). Attendance never completes an objective. */
	evidenceCriterion: string;
	/** Revisits earlier objectives in changed contexts (the mock blocks). */
	cumulative: boolean;
	status: ObjectiveStatus;
	/** Latest recorded evidence / progress note (shown in the mirror). */
	statusNote?: string;
}

/** The last mirror write: content hashes of what LearnHarness itself wrote
 *  (the drift check — a file edited since is never overwritten). */
export interface CurriculumMirrorState {
	at: string;
	noteHash: string;
	registryHash?: string;
}

export interface CurriculumSource {
	kind: "obsidian";
	/** Absolute path of the curriculum note (inside the configured vault). */
	notePath: string;
	/** Absolute path of the registry index.md (inside the registry dir). */
	registryPath?: string;
	/** Absolute folder for the session-note mirror (inside the vault).
	 *  Default (set at save): `Sessions/` beside the curriculum note. */
	sessionsDir?: string;
	/** The note verbatim at import time — kept for re-extraction. */
	rawMarkdown: string;
	importedAt: string;
	lastMirror?: CurriculumMirrorState;
}

/** A session started from this curriculum ("Continue"). */
export interface CurriculumSessionLink {
	chatId: string;
	objectiveId: string;
	startedAt: string;
	/** The session title at link time (plain text in the progress mirror). */
	title?: string;
	/** The mirrored session note LearnHarness owns (path + sha256 of what it
	 *  last wrote); absent until the first session-note write. */
	note?: { path: string; hash: string };
}

export interface CurriculumRecord {
	id: string;
	title: string;
	aliases: string[];
	/** lowercase kebab-case registry directory name. */
	subjectSlug: string;
	/** The note's progress unit label ("block"). */
	progressUnit: string;
	createdAt: string;
	updatedAt: string;
	outcomes: string[];
	objectives: CurriculumObjective[];
	source: CurriculumSource;
	sessions: CurriculumSessionLink[];
	/** SCHEMA STAMP — same discipline as ChatRecord.version: every write
	 *  stamps the current version; a NEWER stamp is refused on read. */
	version?: number;
}

/** The curriculum record format this build writes and understands. */
export const CURRENT_CURRICULUM_VERSION = 1;

/** What the importer / review form produces: a record before it has an
 *  identity, timestamps, or sessions. */
export type CurriculumDraft = Omit<CurriculumRecord, "id" | "createdAt" | "updatedAt" | "sessions" | "version">;

/** List-view summary (the curricula page). */
export interface CurriculumSummary {
	id: string;
	title: string;
	subjectSlug: string;
	updatedAt: string;
	objectiveCount: number;
	completedCount: number;
}

/** The curriculum-context marker's UI payload (native-messages.ts
 *  newCurriculumContextMessage; never model-visible — the model reads the
 *  marker's `content`). Feeds the transcript's CurriculumContextCard. */
export interface CurriculumContextData {
	curriculumId: string;
	title: string;
	objective: { id: string; label: string; evidenceCriterion: string; cumulative: boolean };
	/** Prior objectives the session opens by retrieving, closed-note. */
	retrieval: { id: string; label: string }[];
}
