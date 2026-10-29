import { CurriculumImport } from "@/components/curriculum-import";
import { CurriculumListBody } from "@/components/curriculum-view";
import { stores } from "@/src/server";

export const dynamic = "force-dynamic";

/** The curricula list + "Import from Obsidian" (curriculum feature, Step 1). */
export default function CurriculaPage() {
	return (
		<main className="h-dvh overflow-y-auto">
			<div className="lh-drag h-13" aria-hidden="true" />
			<div className="mx-auto w-full max-w-[46rem] space-y-8 px-4 pb-16">
				<h1 className="font-title text-3xl tracking-tight">Curricula</h1>
				<CurriculumListBody curricula={stores.curriculumStore.listCurricula()} />
				<section className="space-y-3">
					<h2 className="text-xs uppercase tracking-widest text-muted-foreground">Import from Obsidian</h2>
					<CurriculumImport />
				</section>
			</div>
		</main>
	);
}
