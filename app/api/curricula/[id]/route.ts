/** GET /api/curricula/:id — the full curriculum record (404 unknown). */
import { stores } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
	const { id } = await ctx.params;
	let curriculum;
	try {
		curriculum = stores.curriculumStore.getCurriculum(id);
	} catch {
		curriculum = null; // a malformed id is just an unknown one
	}
	if (!curriculum) return Response.json({ error: "Unknown curriculum" }, { status: 404 });
	return Response.json({ curriculum });
}
