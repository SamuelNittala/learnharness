/**
 * POST /api/curricula/:id/mirror — re-mirror progress into the Obsidian
 * note + registry on demand. Hash drift is reported as a `conflict`
 * outcome (200) with nothing written; unknown id is 404.
 */
import { curriculumFailure, mirrorCurriculum } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
	const { id } = await ctx.params;
	try {
		return Response.json({ mirror: mirrorCurriculum(id).result });
	} catch (err) {
		return curriculumFailure(err);
	}
}
