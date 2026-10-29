/**
 * CurriculumMirror — the vault/registry writer adapter (curriculum feature,
 * Step 1). Implements core/ports.ts CurriculumMirror. ONE-WAY: LearnHarness
 * JSON is the source of truth; this adapter only reads, hashes and writes.
 * The text surgery is pure (core/curriculum.ts splices); here live the IO
 * laws:
 *
 *   PATH LAW      every target is realpath-resolved and must sit inside its
 *                 allowed root (vault / registry dir) — `..`, symlink
 *                 escapes, and same-prefix sibling dirs are refused.
 *   DRIFT LAW     a file is overwritten only if its sha256 equals what
 *                 LearnHarness last wrote (or the import baseline, for the
 *                 note); anything else is a `conflict` and nothing is
 *                 written. A file already equal to the new content is
 *                 `unchanged` (no write, mtime untouched).
 *   ATOMIC WRITES temp file in the same directory + rename; new session
 *                 notes use an exclusive create (never overwrite a file
 *                 LearnHarness did not create).
 */

import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CurriculumMirror, MirrorFileResult, MirrorProgressResult, MirrorRoots } from "../core/ports.ts";
import type { CurriculumRecord } from "../core/contracts.ts";
import {
	currentObjective,
	localDate,
	objectiveLabel,
	renderProgressSection,
	spliceRegistryProgress,
	spliceSubsection,
	staticProgressLines,
} from "../core/curriculum.ts";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

export type InsideRoot = { ok: true; path: string } | { ok: false; reason: string };

/** Resolve `target` (absolute) to its real location and require it inside
 *  `root`. The target need not exist: the deepest existing ancestor is
 *  realpath-resolved and the remainder appended. */
export function resolveInsideRoot(root: string, target: string): InsideRoot {
	let rootReal: string;
	try {
		rootReal = fs.realpathSync(root);
	} catch {
		return { ok: false, reason: `root is not accessible: ${root}` };
	}
	let existing = path.resolve(target);
	const rest: string[] = [];
	for (;;) {
		try {
			fs.lstatSync(existing);
			break;
		} catch {
			const parent = path.dirname(existing);
			if (parent === existing) return { ok: false, reason: `no existing ancestor: ${target}` };
			rest.unshift(path.basename(existing));
			existing = parent;
		}
	}
	let real: string;
	try {
		real = fs.realpathSync(existing); // a dangling symlink throws -> refused
	} catch {
		return { ok: false, reason: `path does not resolve: ${target}` };
	}
	const full = path.join(real, ...rest);
	const rel = path.relative(rootReal, full);
	if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
		return { ok: false, reason: `path is outside the allowed root: ${target}` };
	}
	return { ok: true, path: full };
}

function atomicWrite(file: string, text: string): void {
	const tmp = path.join(path.dirname(file), `.${path.basename(file)}.lh-${randomUUID().slice(0, 8)}.tmp`);
	try {
		fs.writeFileSync(tmp, text, "utf-8");
		fs.renameSync(tmp, file);
	} catch (err) {
		fs.rmSync(tmp, { force: true });
		throw err;
	}
}

/** Shared by the note and the registry: guard, compute, write. */
function mirrorFile(opts: {
	root: string | undefined;
	target: string | undefined;
	/** The hash this file must still have for us to overwrite it; undefined = no baseline known. */
	baseline: string | undefined;
	rootLabel: string;
	compute: (current: string) => { ok: true; text: string } | { ok: false; error: string };
}): MirrorFileResult {
	if (!opts.root || !opts.target) return { outcome: "skipped", reason: `no ${opts.rootLabel} configured` };
	const resolved = resolveInsideRoot(opts.root, opts.target);
	if (!resolved.ok) return { outcome: "refused", reason: resolved.reason };
	let current: string;
	try {
		current = fs.readFileSync(resolved.path, "utf-8");
	} catch {
		return { outcome: "refused", reason: `cannot read ${opts.target}` };
	}
	const spliced = opts.compute(current);
	if (!spliced.ok) return { outcome: "refused", reason: spliced.error };
	const currentHash = sha256(current);
	if (spliced.text === current) return { outcome: "unchanged", hash: currentHash };
	if (opts.baseline !== undefined && currentHash !== opts.baseline) {
		return { outcome: "conflict", reason: "the file changed since LearnHarness last wrote it" };
	}
	atomicWrite(resolved.path, spliced.text);
	return { outcome: "written", hash: sha256(spliced.text) };
}

function writeProgress(record: CurriculumRecord, roots: MirrorRoots): MirrorProgressResult {
	const { source } = record;
	const note = mirrorFile({
		root: roots.vaultPath,
		target: source.notePath,
		// The import baseline: until LearnHarness has written, the note must
		// still be exactly what was imported.
		baseline: source.lastMirror?.noteHash ?? sha256(source.rawMarkdown),
		rootLabel: "vault",
		compute: (current) => spliceSubsection(current, "Progress update", renderProgressSection(record, staticProgressLines(current))),
	});

	const current = currentObjective(record);
	const lastWithNote = [...record.sessions].reverse().find((s) => s.note);
	const registry = mirrorFile({
		root: roots.registryDir,
		target: source.registryPath,
		// No import baseline exists for the registry; only its managed
		// bullets change, so a first write is allowed and later ones are
		// guarded by the recorded hash.
		baseline: source.lastMirror?.registryHash,
		rootLabel: "registry directory",
		compute: (text) =>
			spliceRegistryProgress(text, {
				lastSession: lastWithNote?.note ? `${localDate(lastWithNote.startedAt)} — \`${lastWithNote.note.path}\`` : undefined,
				currentCurriculum: record.title,
				currentItem: current ? objectiveLabel(record, current) : "all completed",
			}),
	});
	return { note, registry };
}

function writeSessionNote(
	record: CurriculumRecord,
	link: CurriculumRecord["sessions"][number],
	markdown: string,
	roots: MirrorRoots,
): MirrorFileResult & { path?: string } {
	const vault = roots.vaultPath;
	const dir = record.source.sessionsDir;
	if (!vault || !dir) return { outcome: "skipped", reason: "no vault or sessions folder configured" };
	const resolvedDir = resolveInsideRoot(vault, dir);
	if (!resolvedDir.ok) return { outcome: "refused", reason: resolvedDir.reason };
	const text = markdown.endsWith("\n") ? markdown : `${markdown}\n`;
	const hash = sha256(text);

	if (link.note) {
		// The file LearnHarness owns: overwrite only while it still hashes to
		// what we last wrote.
		const owned = resolveInsideRoot(vault, link.note.path);
		if (!owned.ok) return { outcome: "refused", reason: owned.reason };
		let current: string | null = null;
		try {
			current = fs.readFileSync(owned.path, "utf-8");
		} catch {
			current = null; // deleted since — recreate at the same path
		}
		if (current !== null) {
			if (sha256(current) === hash) return { outcome: "unchanged", hash, path: owned.path };
			if (sha256(current) !== link.note.hash) {
				return { outcome: "conflict", reason: "the session note changed since LearnHarness last wrote it", path: owned.path };
			}
		}
		fs.mkdirSync(path.dirname(owned.path), { recursive: true });
		atomicWrite(owned.path, text);
		return { outcome: "written", hash, path: owned.path };
	}

	fs.mkdirSync(resolvedDir.path, { recursive: true });
	const date = localDate(link.startedAt);
	for (let n = 1; n < 1000; n++) {
		const file = path.join(resolvedDir.path, n === 1 ? `${date}.md` : `${date}-${n}.md`);
		try {
			fs.writeFileSync(file, text, { encoding: "utf-8", flag: "wx" }); // exclusive: never clobber a foreign file
			return { outcome: "written", hash, path: file };
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
			throw err;
		}
	}
	return { outcome: "refused", reason: "no free session-note filename for this date" };
}

export const curriculumMirror: CurriculumMirror = { writeProgress, writeSessionNote };
