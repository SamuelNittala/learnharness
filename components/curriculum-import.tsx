"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { validateCurriculumDraft, type CurriculumDraft, type CurriculumObjective, type ObjectiveStatus } from "@/src/core";

/**
 * Curriculum import (curriculum feature, Step 1): path input -> server-side
 * extraction into a DRAFT -> the learner reviews and edits it -> Save. The
 * review form shows the SAME validation the server enforces
 * (validateCurriculumDraft) and disables Save while any problem remains.
 * Transport-only: never imports the server's agent/store modules.
 */

export interface ApiFailure {
	error: string;
	code?: string;
	problems?: string[];
}

/** A refused request -> an Error carrying the server's message (+ code). */
async function failure(res: Response): Promise<Error> {
	const body = (await res.json().catch(() => null)) as ApiFailure | null;
	const detail = body?.problems?.length ? `${body.error}: ${body.problems.join("; ")}` : (body?.error ?? `HTTP ${res.status}`);
	return Object.assign(new Error(detail), { code: body?.code });
}

export async function postCurriculumImport(notePath: string, fetchLike: typeof fetch = fetch): Promise<CurriculumDraft> {
	const res = await fetchLike("/api/curricula/import", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ notePath }),
	});
	if (!res.ok) throw await failure(res);
	return ((await res.json()) as { draft: CurriculumDraft }).draft;
}

export async function postCurriculumSave(draft: CurriculumDraft, fetchLike: typeof fetch = fetch): Promise<string> {
	const res = await fetchLike("/api/curricula", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(draft),
	});
	if (!res.ok) throw await failure(res);
	return ((await res.json()) as { curriculum: { id: string } }).curriculum.id;
}

/** Swap an objective with its neighbour and renumber `order` (ids are
 *  stable and untouched). Out-of-range moves return the draft unchanged. */
export function moveObjective(draft: CurriculumDraft, index: number, delta: -1 | 1): CurriculumDraft {
	const target = index + delta;
	if (index < 0 || target < 0 || index >= draft.objectives.length || target >= draft.objectives.length) return draft;
	const objectives = [...draft.objectives];
	[objectives[index], objectives[target]] = [objectives[target]!, objectives[index]!];
	return { ...draft, objectives: objectives.map((o, i) => ({ ...o, order: i + 1 })) };
}

const STATUSES: ObjectiveStatus[] = ["not-started", "in-progress", "completed"];
const list = (s: string): string[] => s.split(",").map((x) => x.trim()).filter(Boolean);
const FIELD = "w-full rounded-sm border border-border bg-background px-2 py-1 font-ui text-xs text-foreground outline-none";

/** The review/edit form — pure: all state lives in the parent. */
export function CurriculumReview({
	draft,
	onChange,
	onSave,
	saving = false,
}: {
	draft: CurriculumDraft;
	onChange: (next: CurriculumDraft) => void;
	onSave: () => void;
	saving?: boolean;
}) {
	const problems = validateCurriculumDraft(draft);
	const setObjective = (i: number, patch: Partial<CurriculumObjective>) =>
		onChange({ ...draft, objectives: draft.objectives.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
	return (
		<div data-testid="curriculum-review" className="space-y-4">
			<div className="grid gap-2 sm:grid-cols-2">
				<label className="text-xs">
					Title
					<input data-testid="review-title" className={FIELD} value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} />
				</label>
				<label className="text-xs">
					Subject slug
					<input data-testid="review-slug" className={FIELD} value={draft.subjectSlug} onChange={(e) => onChange({ ...draft, subjectSlug: e.target.value })} />
				</label>
				<label className="text-xs">
					Aliases (comma-separated)
					<input data-testid="review-aliases" className={FIELD} value={draft.aliases.join(", ")} onChange={(e) => onChange({ ...draft, aliases: list(e.target.value) })} />
				</label>
				<label className="text-xs">
					Progress unit
					<input data-testid="review-unit" className={FIELD} value={draft.progressUnit} onChange={(e) => onChange({ ...draft, progressUnit: e.target.value })} />
				</label>
			</div>

			<ol className="space-y-3">
				{draft.objectives.map((o, i) => (
					<li key={o.id || i} data-testid={`review-objective-${o.id}`} className="space-y-2 rounded-md border border-border p-3">
						<div className="flex items-center gap-2 text-xs text-muted-foreground">
							<span className="font-medium text-foreground">{o.order}. {o.id}</span>
							<button type="button" aria-label={`Move ${o.id} up`} disabled={i === 0} onClick={() => onChange(moveObjective(draft, i, -1))} className="rounded-sm px-1 hover:bg-accent disabled:opacity-30">↑</button>
							<button type="button" aria-label={`Move ${o.id} down`} disabled={i === draft.objectives.length - 1} onClick={() => onChange(moveObjective(draft, i, 1))} className="rounded-sm px-1 hover:bg-accent disabled:opacity-30">↓</button>
						</div>
						<input aria-label={`${o.id} title`} className={FIELD} value={o.title} onChange={(e) => setObjective(i, { title: e.target.value })} />
						<textarea aria-label={`${o.id} objective`} rows={2} className={FIELD} value={o.objective} onChange={(e) => setObjective(i, { objective: e.target.value })} />
						<input aria-label={`${o.id} prerequisites`} className={FIELD} placeholder="prerequisite ids, comma-separated" value={o.prerequisites.join(", ")} onChange={(e) => setObjective(i, { prerequisites: list(e.target.value) })} />
						<textarea aria-label={`${o.id} checkpoint`} rows={2} className={FIELD} value={o.checkpoint} onChange={(e) => setObjective(i, { checkpoint: e.target.value })} />
						<textarea aria-label={`${o.id} evidence criterion`} rows={2} className={FIELD} value={o.evidenceCriterion} onChange={(e) => setObjective(i, { evidenceCriterion: e.target.value })} />
						<div className="flex items-center gap-4 text-xs">
							<select aria-label={`${o.id} status`} className={FIELD + " !w-auto"} value={o.status} onChange={(e) => setObjective(i, { status: e.target.value as ObjectiveStatus })}>
								{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
							</select>
							<label className="flex items-center gap-1">
								<input type="checkbox" checked={o.cumulative} onChange={(e) => setObjective(i, { cumulative: e.target.checked })} />
								cumulative
							</label>
						</div>
					</li>
				))}
			</ol>

			{problems.length > 0 && (
				<ul data-testid="review-problems" role="alert" className="list-disc space-y-0.5 pl-5 text-xs text-red-400">
					{problems.map((p) => <li key={p}>{p}</li>)}
				</ul>
			)}
			<button
				type="button"
				data-testid="review-save"
				disabled={problems.length > 0 || saving}
				onClick={onSave}
				className="rounded-md border border-border px-3 py-1.5 text-xs uppercase tracking-wider transition-colors hover:bg-accent disabled:opacity-40"
			>
				{saving ? "Saving…" : "Save curriculum"}
			</button>
		</div>
	);
}

/** Path input -> draft -> review -> save -> the curriculum's page. */
export function CurriculumImport() {
	const router = useRouter();
	const [notePath, setNotePath] = useState("");
	const [draft, setDraft] = useState<CurriculumDraft | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const run = async (work: () => Promise<void>) => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await work();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};
	return (
		<div data-testid="curriculum-import" className="space-y-4">
			<div className="flex gap-2">
				<input
					data-testid="import-path"
					aria-label="Absolute path of the curriculum note"
					className={FIELD}
					placeholder="/absolute/path/to/Curriculum.md (inside your vault)"
					value={notePath}
					onChange={(e) => setNotePath(e.target.value)}
				/>
				<button
					type="button"
					data-testid="import-run"
					disabled={busy || !notePath.trim()}
					onClick={() => void run(async () => setDraft(await postCurriculumImport(notePath.trim())))}
					className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs uppercase tracking-wider transition-colors hover:bg-accent disabled:opacity-40"
				>
					{busy && !draft ? "Importing…" : "Import"}
				</button>
			</div>
			{error && <p role="alert" data-testid="import-error" className="whitespace-pre-wrap break-words text-xs text-red-400">{error}</p>}
			{draft && (
				<CurriculumReview
					draft={draft}
					onChange={setDraft}
					saving={busy}
					onSave={() => void run(async () => router.push(`/curricula/${await postCurriculumSave(draft)}`))}
				/>
			)}
		</div>
	);
}
