---
name: four-forms
description: Think a subject through with the Four Forms of Thinking (by GoodRelax, compiled from classic thinking moves). The four forms, in order, are Divide, Compare, Infer, and Transform; each has two core moves and one optional move. It works in the chat, and on the local whiteboard of this plugin (server board-control) when the person asks for it or agrees to it. Use when the user types /gr-whiteboard:four-forms, asks to think a subject through with the Four Forms of Thinking, or when consult-on-board or issue-driven picks it.
---

# four-forms

Use the Four Forms of Thinking and the board to help the person look at a subject from new angles, one form at a time.

Talk in the chat first, one form at a time in short bullets. Open the board only when the person asks for it, or when a picture would make it clearer and you ask "Shall we sort this out on the whiteboard?" and they agree; then run it as the skill `talk-on-board` says. After `open_board`, start the watch Monitor of `talk-on-board` (Open step 2, `client.js watch`) at once, or you miss every Send. Draw the person's words, not your own ideas, and validate them, as `consult-on-board` says.

## The forms

| Form | Core moves | Optional move | It holds when |
|---|---|---|---|
| Lv1 Divide | Divide (whole into parts), Name (a sign for each) | Classify (parts into kinds) | The parts do not overlap and make the whole. One rule sorts the parts into kinds, each part in one kind. One sign for each object |
| Lv2 Compare | Analogy (alike), Contrast (opposite) | Orthogonal (unrelated) | Analogy points the same way, Contrast the opposite way, Orthogonal shows no relation |
| Lv3 Infer | Induction (find the rule), Deduction (find the result) | Abduction (find the cause) | Induction: a law from two or more cases (conjecture). Deduction: a result from a cause and a law (certain). Abduction: the cause that best explains the result (selection) |
| Lv4 Transform | Concrete (add attributes), Abstract (remove attributes) | Synthesis (recombine abstractions) | Concrete adds attributes and Abstract removes them. Synthesis recombines several abstractions with weights into one |

## Run

1. Show the whole flow first: `draw_mermaid` with `file` set to `SKILL_DIR/data/forms-ja.mmd` for a Japanese speaker, or `SKILL_DIR/data/forms-en.mmd` (absolute paths; SKILL_DIR is the folder of this file). Above it, write the title: the framework name and the subject (e.g. "Four Forms of Thinking  Sample Inc. new product").
2. After the drawing, make the optional moves gray (Classify, Orthogonal, Abduction, Synthesis: the box and its text, `edit_items` color gray), and make the frames of the three link boxes between the forms transparent (`strokeColor` "transparent"). Find the ids with `read_board` (`type` text gives each text with its box in `containerId`).
3. Start with Lv1 Divide: define the words. If the person starts at Lv2 or later, skip Lv1, and come back to it when a term needs a definition.
4. Go one form at a time. Use the optional moves only when they help.
