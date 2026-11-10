---
name: four-forms
description: Think a subject through with the Four Forms of Thinking (by GoodRelax, compiled from classic thinking moves). The four forms, in order, are Divide, Compare, Infer, and Transform; each has two core moves and one optional move. Reach for it when a person is stuck on a subject, a plan or a business idea, and wants to think it through. Not for a bug or a coding task. It works in the chat, and on the local whiteboard of this plugin (server board-control) when the person asks for it or agrees to it. Use when the user types /gr-whiteboard:four-forms, asks to think a subject through with the Four Forms of Thinking, or when consult-on-board or issue-driven picks it.
---

# four-forms

Use the Four Forms of Thinking and the board to rebuild how the person looks at a subject, from a higher vantage point, one form at a time. Use them when the person has run out of ideas, is stuck, wants a fresh idea, or wants to compare one thing with another.

Talk in the chat first, one form at a time in short bullets. Open the board only when the person asks for it, or when a picture would make it clearer and you ask "Shall we sort this out on the whiteboard?" and they agree; then run it as the skill `talk-on-board` says. After `open_board`, start the watch Monitor of `talk-on-board` (Open step 2, `client.js watch`) at once, or you miss every Send. Draw the person's words, not your own ideas, and validate them, as `consult-on-board` says.

## The forms

| Form | Core moves | Optional move | It holds when |
|---|---|---|---|
| Lv1 Divide | Divide (whole into parts), Name (a sign for each) | Classify (parts into kinds) | The parts do not overlap and make the whole. One rule sorts the parts into kinds, each part in one kind. One sign for each object. Name a part by what it does or asks of the person, not by what it is made of: a name of that kind carries over to another field |
| Lv2 Compare | Analogy (alike), Contrast (opposite) | Orthogonal (unrelated) | Analogy points the same way, Contrast the opposite way, Orthogonal shows no relation. Analogy keeps the relations between the parts, and it may cross into a far field |
| Lv3 Infer | Induction (find the rule), Deduction (find the result) | Abduction (find the cause) | Induction: a law from two or more cases (conjecture). Deduction: a result from a cause and a law (certain). Abduction: the cause that best explains the result (selection) |
| Lv4 Transform | Concrete (add attributes), Abstract (remove attributes) | Synthesis (recombine abstractions) | Concrete adds attributes and Abstract removes them. Synthesis recombines several abstractions with weights into one. Abstract keeps the relations that matter and stops while they still say something: a shape that fits anything is too high |

## Run

1. Show the whole flow first: `draw_mermaid` with `file` set to `SKILL_DIR/data/forms-ja.mmd` for a Japanese speaker, or `SKILL_DIR/data/forms-en.mmd` (absolute paths; SKILL_DIR is the folder of this file). Above it, write the title with `draw_skeletons` and `at`: the framework name and the subject (e.g. "Four Forms of Thinking  Sample Inc. new product"). Below it, write "Gray = optional" in gray.
2. After the drawing, make the optional moves gray (Classify, Orthogonal, Abduction, Synthesis: the box and its text, `edit_items` color gray), and make the frames of the three link boxes between the forms transparent (`strokeColor` "transparent"). Find the ids with `read_board` (`type` text gives each text with its box in `containerId`).
3. Start with Lv1 Divide: define the words. If the person starts at Lv2 or later, skip Lv1, and come back to it when a term needs a definition.
4. Go one form at a time. Use the optional moves only when they help. Write the person's words in a column to the right of the flow, one heading per form, and pass `at` to `write_answer` so that your answers stay beside that column.
5. You may go back to an earlier form when a later one shows a gap.

## Far field

When it would help, or the person asks for it: at Lv2 Analogy, after the person has compared the parts of their own subject, say the shape in one line, in relations only, with the words of the person's field taken out. If the line fits anything, it is too abstract: put one relation back.

Then offer once, as an invitation with examples, in words like: "The same shape may show up far from your field: for example A, B, or C. Which of these might work? Or does another one come to mind?" Give two or three fields that have nothing to do with the person's field and little to do with each other, each with a few words on why it might fit. They are seeds, not answers: the person may pick one, change one, bring their own, or pass. If the person picks one, or asks for it, do this. Here you may bring your own ideas: the candidate fields and the facts about them are yours, and what they mean at home is the person's.

1. Think the chosen field through with the person: what happens there, and who watches what.
2. Check the facts of that field; say so when you are unsure.
3. Lay out the pairs: here on one side, there on the other, each relation beside its partner. On the board, use `draw_table` with two columns (this is not a frame) and put it next to the Lv2 notes. In the chat, use a two-column list.
4. Say which relations do not carry over. Every far field has some; name at least one, and name the part of the person's problem it says nothing about.
5. Ask the person for the case most likely to break the match. When it breaks, go back to the far field and ask how that field handles the same case. A match improves in both directions.
6. Hand it back at Lv4 Concrete: the person says what the far-field practice becomes at home, and how they will test it there.

Stay out of a far field that only repeats the person's own field in other words.

A far field gives ideas, not proof. Test them in the person's own field.
