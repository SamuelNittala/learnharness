/**
 * POST /api/curricula/import { notePath } — turn an Obsidian curriculum note
 * into a DRAFT (curriculum feature, Step 1). The note is read on the server
 * by absolute path and must resolve inside the configured vault (a browser
 * upload would expose only a file name). NOTHING is persisted: the learner
 * reviews/edits the draft, then POST /api/curricula saves it.
 *
 *   200 {draft} · 400 invalid path / outside vault / vault not configured ·
 *   404 note not found ·
 *   503 models_not_configured | provider_key_missing (the notes-import envelopes)
 */
import { curriculumFailure, importCurriculumDraft } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { notePath?: unknown };
	try {
		const draft = await importCurriculumDraft(typeof body.notePath === "string" ? body.notePath : "", req.signal);
		return Response.json({ draft });
	} catch (err) {
		return curriculumFailure(err);
	}
}
