---
name: five-whys
description: Run a Five Whys analysis (Toyota) with the person. It asks why, one step at a time, checks each answer, and walks each branch down to its root cause, then draws a clean chart with the measures. It works in the chat, and on the local whiteboard of this plugin (server board-control) when the person asks for it or agrees to it. Use when the user types /gr-whiteboard:five-whys, asks for a Five Whys (Nazenaze) analysis, or when consult-on-board or issue-driven picks it.
---

# five-whys

Ask why with the person, one step at a time, until each branch reaches its root cause. Use the person's words, not your own guesses.

Talk in the chat first, one why at a time in short bullets. Open the board only when the person asks for it, or when a picture would make it clearer and you ask "Shall we sort this out on the whiteboard?" and they agree; then run it as the skill `talk-on-board` says. On the board, write the draft as the person's words under the problem, one branch at a time.

## Checks

Check each answer as you go. When one fails, ask a short question; do not fix it yourself.

- One box holds one sentence. Do not leave out the subject or the verb, nor the object of a transitive verb.
- The subject is a role (worker, designer), never a person's name.
- Each answer is a cause of the answer before it, not a measure.
- Do not skip a step.
- Do not stop at blaming a person. Ask what let the mistake happen.
- Occurrence (why it happened) and outflow (why it was not caught) are separate branches. Split other branches when needed.
- Five is not a rule. Stop at the root cause, sooner or later.
- Do not say the same thing twice in other words. Do not let the logic loop.
- A root cause is a cause that prevents the problem from coming back when it is removed, and that the team itself can act on with a concrete control or improvement.

## Clean chart

1. When a branch reaches its root cause, and when all branches are done, ask "Shall I draw the clean chart?". Draw only after a yes.
2. Before drawing, read each branch back from the root cause to the problem with "so" ("A, so B"). Where a link does not hold, ask the person.
3. Draw it right of the draft with `draw_mermaid`; keep the draft. Follow `SKILL_DIR/data/chart-ja.mmd` for a Japanese speaker, or `SKILL_DIR/data/chart-en.mmd` (SKILL_DIR is the folder of this file): the problem on the left, the whys to the right, one row per branch, the measure right of its root cause. Above it, write the title: the framework name and the subject.
4. Make the root cause boxes thick (`edit_items`, `strokeWidth` 4).
