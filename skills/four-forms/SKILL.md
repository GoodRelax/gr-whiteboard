---
name: four-forms
description: Think a subject through with the Four Forms of Thinking (by GoodRelax, compiled from classic thinking moves) on the local whiteboard. Four forms in order: Divide, Compare, Infer, Transform; each has two core moves and one optional move. Works only on the board; it uses the board tools of this plugin (server board-control). Use when the user types /gr-whiteboard:four-forms, asks on the board to think a subject through with the Four Forms of Thinking, or when consult-on-board or issue-driven picks it.
---

# four-forms

Use the Four Forms of Thinking and the board to help the person look at a subject from new angles, one form at a time.

Open and run the board as the skill `talk-on-board` says. Draw the person's words, not your own ideas, as `consult-on-board` says.

## The forms

| Form | Core moves | Optional move |
|---|---|---|
| Lv1 Divide | Divide (whole into parts), Name (a sign for each) | Classify (parts into kinds) |
| Lv2 Compare | Analogy (alike), Contrast (opposite) | Orthogonal (unrelated) |
| Lv3 Infer | Induction (find the rule), Deduction (find the result) | Abduction (find the cause) |
| Lv4 Transform | Concrete (add attributes), Abstract (remove attributes) | Synthesis (recombine abstractions) |

## Run

1. Show the whole flow first: `draw_mermaid` with `file` set to `SKILL_DIR/data/forms-ja.mmd` for a Japanese speaker, or `SKILL_DIR/data/forms-en.mmd` (absolute paths; SKILL_DIR is the folder of this file).
2. After the drawing, make the optional moves gray (Classify, Orthogonal, Abduction, Synthesis: the box and its text, `edit_items` color gray), and make the frames of the three link boxes between the forms transparent (`strokeColor` "transparent"). Find the ids with `read_board` (`type` text gives each text with its box in `containerId`).
3. Start with Lv1 Divide: define the words. If the person starts at Lv2 or later, skip Lv1, and come back to it when a term needs a definition.
4. Go one form at a time. Use the optional moves only when they help.
