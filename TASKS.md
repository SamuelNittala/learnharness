# Tasks

Plan: `/Users/samuelnittala/.claude/plans/learnharness-curriculum-import.md` (Step 1 only).
Process per task: spec -> failing test -> implement. Gates: `npm test`, `npm run lint`, `npm run typecheck`.

## Current

- [ ] 6.1-6.4 Manual data verification with the user (backups, System Design import, session-note import, Continue on Block 4). Not started by design.

## Completed

- [x] Mirror carries the note's static Progress lines (Calendar deadline / Session maximum / Remediation/retake maximum) over verbatim: `staticProgressLines` + `renderProgressSection(r, carried)` in `src/core/curriculum.ts`, used by `src/store/obsidian-mirror.ts`; tests in `tests/curriculum-core.test.ts` and `tests/curriculum-mirror.test.ts`

- [x] 2.4 Prompts approved by the user and wired: `prober/20-curriculum.md`, `teacher/15-curriculum.md`, importer prompt inline as `CURRICULUM_IMPORT_PROMPT`
- [x] 2.5 `tests/prompt-overrides.test.ts` segment lists updated
- [x] 3.5b Importer prompt wired; the 501 `import_prompt_pending` path removed

- [x] 0.2 TASKS.md created
- [x] 0.3 Next.js docs read (`node_modules/next/dist/docs/01-app/.../route.md`, `page.md`): `params` is a Promise in route handlers and pages
- [x] 1.1 Contract `src/core/contracts/curriculum.ts` + ports `CurriculumStore` / `CurriculumMirror`
- [x] 1.2/1.3 `tests/curriculum-core.test.ts` + `src/core/curriculum.ts` (validation, current objective, retrieval set, context text, progress rendering, splices)
- [x] 1.4/1.5 `tests/curriculum-store.test.ts` + `src/store/curricula.ts`, `PATHS.curricula`, `stores.ts`
- [x] 2.1-2.3 Curriculum-context marker: `native-messages.ts`, `view.ts`, `components/curriculum-context-card.tsx`, `chat.tsx` case (`tests/curriculum-marker.test.ts`)
- [x] 3.1-3.3 `src/agent/subagents/curriculum-import.ts` (`extractCurriculum`, `submit_curriculum`), `curriculumImporter` role on the strong slot (`tests/curriculum-import.test.ts`)
- [x] 3.4/3.5 Seam `src/server/curricula.ts`, routes under `app/api/curricula/**`, `obsidian` settings section + Settings UI (`tests/curriculum-routes.test.ts`, `tests/curriculum-settings.test.ts`)
- [x] 4.1/4.2 Continue branch of `POST /api/chats`
- [x] 4.3/4.4 `components/curriculum-import.tsx`, `components/curriculum-view.tsx`, `app/curricula/**`, sidebar link (`tests/render-curriculum.test.tsx`)
- [x] 5.1-5.3 `src/store/obsidian-mirror.ts` (note, registry, session notes), per-turn session-note hook in `chat-handler.ts`, mirror route (`tests/curriculum-mirror.test.ts`)
- [x] Q10 `docs/architecture.md` systems table + contracts list
