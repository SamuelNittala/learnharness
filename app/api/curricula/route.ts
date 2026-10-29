/**
 * /api/curricula — the curriculum collection (curriculum feature, Step 1).
 *   GET   summaries, newest activity first.
 *   POST  save a REVIEWED draft (the importer's output after the learner's
 *         edits): validated, persisted, first-mirrored to Obsidian.
 *         201 {curriculum, mirror} | 400 {error, code, problems?}.
 */
import { curriculumFailure, saveCurriculumDraft, stores } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json({ curricula: stores.curriculumStore.listCurricula() });
}

export async function POST(req: Request) {
	const body = await req.json().catch(() => null);
	try {
		return Response.json(await saveCurriculumDraft(body), { status: 201 });
	} catch (err) {
		return curriculumFailure(err);
	}
}
