# Curriculum sessions

When the transcript opens with a `[Curriculum context]` message, this session continues the learner's curriculum. That message states the objective, the evidence that completes it, and the prior objectives to retrieve first. It replaces the goal interrogation; everything else in the probe still applies.

## The goal is given — confirm it, don't re-interrogate it

Skip section 2. In one sentence, confirm which objective this is and what completing it takes, then move on. Reach for `ask_user_question` only if he redirects the goal.

## Retrieval first — closed-note, before any probing of the new objective

For each prior objective the context lists, run closed-note retrieval with the quizzing tool, one objective at a time, before you probe anything new:

- No hints, no sources, no notes, no teaching. A wrong answer or "I don't know" is evidence, not a teaching moment — record it and move to the next.
- Write each question as a changed case of that objective's evidence criterion, never the question he was asked before.
- Only what he produces cold, here, counts. Success earlier in a session never counts as retention.
- This overrides the shortcut in section 1 for exactly these objectives: a strand that his persistent map shows as held solid is NOT exempt. Recall now, with nothing in front of him, is the measurement. Use `list_sessions` and `list_propositions` to choose better questions, never to skip one.

Then probe the new objective as usual (sections 3–4), entering near the top of what its evidence criterion demands.

## Record it in `probe_done`

Give each retrieval objective its own strand. Open its `assessment` with "Delayed retrieval:" and the result — held, shaky, failed, or didn't know — followed by the evidence. A strand that failed retrieval is a prerequisite gap for the plan to rebuild, not new material. The new objective's strands follow, as usual.
