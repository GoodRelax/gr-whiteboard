---
name: five-whys
description: Run a Five Whys analysis (Toyota) with the person. It asks why, one step at a time, checks each answer, and walks each branch down to its root cause, then draws a clean chart with the measures. It works in the chat, and on the local whiteboard of this plugin (server board-control) when the person asks for it or agrees to it. Use when the user types /gr-whiteboard:five-whys, asks for a Five Whys (Nazenaze) analysis, or when consult-on-board or issue-driven picks it.
---

# five-whys

Ask why with the person, one step at a time, until each branch reaches its root cause. Use the person's words, not your own guesses.

Talk in the chat first, one why at a time in short bullets. Open the board only when the person asks for it, or when a picture would make it clearer and you ask "Shall we sort this out on the whiteboard?" and they agree; then run it as the skill `talk-on-board` says.

## Board

- From the top: the title (the framework name and the subject), the root cause definition from `SKILL_DIR/data/labels.json` in small gray text, then the chart (SKILL_DIR is the folder of this file).
- Answer as in a phone chat: `write_answer` puts your answer below and left of the person's last comment. When the person only wrote in the chart, put it under your previous answer instead (`at`).
- Draw the draft in the shape of `SKILL_DIR/data/chart-ja.mmd` for a Japanese speaker, or `SKILL_DIR/data/chart-en.mmd`, with the person's words: the problem on the left, the whys to the right, occurrence on top and outflow below, each first branch marked at its head. When a branch grows, add its boxes to the right.

## Checks

Check each answer as you go. When one fails, ask a short question; do not fix it yourself. When the subject is plain, add it yourself, and confirm such additions once, when a step settles.

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

1. When all branches are done, ask "Shall I draw the clean chart?". Draw only after a yes.
2. Before drawing, read each branch back from the root cause to the problem with "so" ("A, so B"). Where a link does not hold, ask the person.
3. Draw it right of the draft with `draw_mermaid` in the shape of the template, one row per branch; keep the draft. Head each box with its step ("Why 1", "Why 2", and "Root cause" for the root cause), in the person's language. Write its own title and the gray definition above it.
4. Line up the root causes in one column and the measures in the next (`edit_items`).
5. Make the root cause boxes thick (`edit_items`, `strokeWidth` 4).
