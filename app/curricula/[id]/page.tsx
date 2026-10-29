import { notFound } from "next/navigation";
import { CurriculumView } from "@/components/curriculum-view";
import { slotsConfigured } from "@/src/core";
import { findCurriculum, readSettingsRecord } from "@/src/server";

export const dynamic = "force-dynamic";

export default async function CurriculumPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const curriculum = findCurriculum(id);
	if (!curriculum) notFound();
	return (
		<main className="h-dvh overflow-y-auto">
			<div className="lh-drag h-13" aria-hidden="true" />
			<div className="mx-auto w-full max-w-[46rem] px-4 pb-16">
				<CurriculumView curriculum={curriculum} configured={slotsConfigured(readSettingsRecord()?.models)} />
			</div>
		</main>
	);
}
