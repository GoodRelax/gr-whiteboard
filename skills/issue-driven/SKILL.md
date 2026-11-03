---
name: issue-driven
description: Run the Issue-Driven Framework (by GoodRelax) on the local whiteboard. It walks from the background of a matter to the one question worth answering (the Issue), then down through challenges, measures, and tasks to the answer, one step at a time. Works only on the board; it uses the board tools of this plugin (server board-control). Use when the user types /gr-whiteboard:issue-driven, asks on the board to sort out a matter with the Issue-Driven Framework (Yomon), or when consult-on-board picks it.
---

# issue-driven

Use the Issue-Driven Framework and the board to find, with the person, the one question worth answering, and to lead them step by step to its answer.

Open and run the board as the skill `talk-on-board` says. Draw the person's words, not your own ideas, and validate them, as `consult-on-board` says.

## The eight steps

| Step | What it holds | It holds when |
|---|---|---|
| Background | The situation as it is | Free form |
| Purpose | What the work is for | A verb phrase |
| Analysis | Facts sorted, compared, and read | Free form; it leads to the Issue |
| Issue | The one question worth answering | One question that can be answered, is worth answering, and is essential. Do not go on to Challenge until it is a question |
| Challenge | What to overcome to answer it (strategy) | A verb phrase; a strategy to solve the Issue |
| Measure | How to overcome each challenge (tactics) | A verb phrase; the tactics for its Challenge |
| Task | The concrete work of each measure | A verb phrase; the concrete work of its Measure |
| Answer | The answer to the Issue, reached through the steps | A statement that answers the Issue, or says it is not reached yet and why |

The Japanese labels of the steps are in `data/labels.json` (SKILL_DIR is the folder of this file).

## Run

Show the eight steps in one row first. Ask the person step by step: Background, Purpose, Analysis, Issue, Challenge, Measure, Task, Answer. Organize each answer under its heading. Never skip a step.

- The row: `draw_mermaid` with `file` set to `SKILL_DIR/data/flow-ja.mmd` for a Japanese speaker, or `SKILL_DIR/data/flow-en.mmd` (absolute paths). Above it, write the title: the framework name and the subject (e.g. "Issue-Driven Framework  Sample Inc. study group").
- Fill the box of the current step light blue (`edit_items`, `bg` blue). Leave the other boxes as they are. Add no other colors.
- Under the row, write the headings ("# Background", in the person's language) with the person's words as bullets. Write each measure indented under its challenge, and each task under its measure.
- Inside a step, you may suggest one other framework as a tool, with `consult-on-board`:

  | Step | Tools |
  |---|---|
  | Background | pest, 3c, 5-forces |
  | Purpose | mvv, smart |
  | Analysis | swot, fishbone, as-is-to-be, four-forms |
  | Issue | 5-whys, hmw |
  | Challenge | logic-tree, ansoff, mece |
  | Measure | ecrs, scamper, decision-matrix, eisenhower |
  | Task | raci, gantt, kanban |
  | After the answer | kpt, ywt, pdca |
