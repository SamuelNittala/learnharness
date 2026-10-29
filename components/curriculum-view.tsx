"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	currentObjective,
	curriculumOpeningPrompt,
	objectiveLabel,
	type CurriculumObjective,
	type CurriculumRecord,
} from "@/src/core";
import { useStrongKeyless, useZeroKeys } from "@/components/setup-cta";
import { useSettingsDialog } from "@/components/settings/settings-dialog";
import { cn } from "@/lib/utils";

/**
 * The curriculum page (curriculum feature, Step 1): objectives grouped by
 * phase with status chips, the current objective highlighted, and a
 * Continue action that creates a curriculum session. The client sends ONLY
 * the curriculumId — the server builds the context marker.
 */

/** Continue's whole behavior as one pure seam (the startDraftSession
 *  precedent): create the session, return the push target. Throws the
 *  server's message on refusal. */
export async function startCurriculumSession(curriculumId: string, fetchLike: typeof fetch): Promise<string> {
	const res = await fetchLike("/api/chats", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ curriculum: { curriculumId } }),
	});
	const body = (await res.json().catch(() => null)) as { id?: string; prompt?: string; error?: string } | null;
	if (!res.ok || !body?.id || !body.prompt) throw new Error(body?.error ?? `HTTP ${res.status}`);
	return `/chat/${body.id}?prompt=${encodeURIComponent(body.prompt)}`;
}

/** Objectives grouped by phase, preserving first-seen phase order. */
export function groupByPhase(objectives: readonly CurriculumObjective[]): { phase: string; objectives: CurriculumObjective[] }[] {
	const groups: { phase: string; objectives: CurriculumObjective[] }[] = [];
	for (const o of [...objectives].sort((a, b) => a.order - b.order)) {
		const phase = o.phase ?? "";
		const group = groups.find((g) => g.phase === phase);
		if (group) group.objectives.push(o);
		else groups.push({ phase, objectives: [o] });
	}
	return groups;
}

const CHIP: Record<CurriculumObjective["status"], string> = {
	"not-started": "border-border text-muted-foreground",
	"in-progress": "border-amber-500/50 text-amber-500",
	completed: "border-emerald-500/50 text-emerald-500",
};

/** The pure body — all behavior arrives as props (the render-test seam). */
export function CurriculumViewBody({
	curriculum,
	busy = false,
	error = null,
	onContinue,
}: {
	curriculum: CurriculumRecord;
	busy?: boolean;
	error?: string | null;
	onContinue: () => void;
}) {
	const current = currentObjective(curriculum);
	const done = curriculum.objectives.filter((o) => o.status === "completed").length;
	return (
		<div data-testid="curriculum-view" className="space-y-5">
			<header className="space-y-1">
				<h1 className="font-title text-3xl tracking-tight">{curriculum.title}</h1>
				<p className="text-xs text-muted-foreground">
					{done}/{curriculum.objectives.length} {curriculum.progressUnit}s completed
				</p>
			</header>
			<div className="flex items-center gap-3">
				<button
					type="button"
					data-testid="curriculum-continue"
					disabled={busy || !current}
					onClick={onContinue}
					className="rounded-md border border-border px-3 py-1.5 text-xs uppercase tracking-wider transition-colors hover:bg-accent disabled:opacity-40"
				>
					{current ? `Continue — ${curriculumOpeningPrompt(curriculum, current).replace(/^Continue: /, "")}` : "All completed"}
				</button>
				{error && <p role="alert" data-testid="curriculum-continue-error" className="text-xs text-red-400">{error}</p>}
			</div>
			{groupByPhase(curriculum.objectives).map((g) => (
				<section key={g.phase || "_"} data-testid={`phase-${g.phase || "none"}`} className="space-y-1.5">
					{g.phase && <h2 className="text-xs uppercase tracking-widest text-muted-foreground">{g.phase}</h2>}
					<ul className="space-y-1">
						{g.objectives.map((o) => (
							<li
								key={o.id}
								data-testid={`objective-${o.id}`}
								data-current={current?.id === o.id ? "true" : "false"}
								className={cn("flex items-start gap-3 rounded-md border px-3 py-2 text-sm", current?.id === o.id ? "border-foreground/40 bg-accent/40" : "border-transparent")}
							>
								<span className={cn("mt-0.5 shrink-0 rounded-full border px-2 text-[10px] uppercase tracking-wider", CHIP[o.status])}>{o.status}</span>
								<span className="min-w-0">
									<span className="block">{objectiveLabel(curriculum, o)}</span>
									{o.cumulative && <span className="block text-xs text-muted-foreground">cumulative</span>}
								</span>
							</li>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}

export function CurriculumView({ curriculum, configured }: { curriculum: CurriculumRecord; configured: boolean }) {
	const router = useRouter();
	const settings = useSettingsDialog();
	const zeroKeys = useZeroKeys();
	const strongKeyless = useStrongKeyless();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const onContinue = () => {
		if (busy) return;
		// The pre-send guards (the home/new-session precedent): refuse BEFORE
		// the session is created — a refused first turn would leave an
		// orphan error-shell chat in the sidebar.
		if (!configured) return settings.open("agent");
		if (zeroKeys || strongKeyless) return settings.open("keys");
		setBusy(true);
		setError(null);
		startCurriculumSession(curriculum.id, fetch)
			.then((target) => router.push(target))
			.catch((err: unknown) => {
				setError(err instanceof Error ? err.message : String(err));
				setBusy(false);
			});
	};
	return <CurriculumViewBody curriculum={curriculum} busy={busy} error={error} onContinue={onContinue} />;
}

/** The curricula list row data (the list page renders links to /curricula/:id). */
export function CurriculumListBody({ curricula }: { curricula: { id: string; title: string; completedCount: number; objectiveCount: number }[] }) {
	return (
		<ul data-testid="curricula-list" className="space-y-1">
			{curricula.length === 0 && <li className="text-xs text-muted-foreground">No curricula yet — import one from Obsidian.</li>}
			{curricula.map((c) => (
				<li key={c.id}>
					<Link href={`/curricula/${c.id}`} className="flex items-baseline justify-between gap-4 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent">
						<span className="min-w-0 truncate">{c.title}</span>
						<span className="shrink-0 text-xs text-muted-foreground">{c.completedCount}/{c.objectiveCount}</span>
					</Link>
				</li>
			))}
		</ul>
	);
}
