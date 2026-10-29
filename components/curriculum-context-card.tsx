"use client";

import { useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CurriculumContextData } from "@/src/core";

/**
 * The curriculum-context card (curriculum feature, Step 1): the session's
 * curriculum pick — message[0] of a session started with Continue.
 * Scaffolding, not a turn: minimal, muted, collapsed by default; expand
 * reveals the objective's evidence criterion and the prior objectives the
 * session opens by retrieving (closed-note). The model reads the same
 * content through the marker's own text (toLlmMessages); this card is the
 * learner's face of it. Mirrors graph-context-card.tsx.
 */

export function CurriculumContextCard({ data }: { data: CurriculumContextData }) {
	const [open, setOpen] = useState(false);
	const retrieval = data?.retrieval ?? [];
	return (
		<div data-testid="curriculum-context-card" className="my-1">
			<button
				type="button"
				data-testid="curriculum-context-toggle"
				onClick={() => setOpen((v) => !v)}
				className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
			>
				<ChevronRightIcon aria-hidden="true" className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
				<span className="font-medium">Curriculum</span>
				<span className="min-w-0 flex-1 truncate">{data?.objective?.label}</span>
			</button>
			{open && (
				<div data-testid="curriculum-context-body" className="mt-1 space-y-1 rounded-lg border border-dashed border-border/70 px-4 py-3 text-xs leading-relaxed">
					<div>
						<span className="font-medium text-foreground/80">{data?.title}</span>
						{data?.objective?.cumulative ? <span className="text-muted-foreground"> — cumulative</span> : null}
					</div>
					<div className="text-muted-foreground">Completes when: {data?.objective?.evidenceCriterion}</div>
					{retrieval.length > 0 && (
						<div className="pt-1 text-muted-foreground">
							<div className="font-medium text-foreground/80">Retrieved first, closed-note</div>
							{retrieval.map((o) => (
								<div key={o.id} data-testid={`curriculum-context-retrieval-${o.id}`}>
									{o.label}
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
