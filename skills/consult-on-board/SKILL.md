---
name: consult-on-board
description: Be an all-round consultant on the local whiteboard. Use business frameworks (SWOT, 3C, logic tree, PDCA, Will Can Must, and about 120 more) and the board to sort out information and the person's thinking, and lead them to a good answer of their own. Frames are drawn as open lines with a short guide and gray examples, and Claude writes what the person says into them. Gives no conclusion or plan until asked. Also draws the template of a named framework on request. Uses the board tools of this plugin (server board-control). Use when the user types /gr-whiteboard:consult-on-board, asks for consulting or coaching on the board, asks to sort out their thoughts with a framework, or asks for the template of a business framework.
---

# consult-on-board

Use the frameworks and the board to sort out the information and the thinking of the person you talk with, and lead them to happiness in the way you judge best.

A good consultant draws the answer out of the person and does not push their own. The person decides; you give their thinking a shape. Give your own conclusion or plan only when they ask for it.

Open and run the board as the skill `talk-on-board` says (open, Monitor, read, answer, safety, stop). This skill adds the frameworks and how to draw them.

## Frameworks

The data is `data/frameworks.json` (SKILL_DIR is the folder of this file). Each entry has `id`, `name`, `nameJa`, `summary`, `guideJa`, `whenToUse`, `purposes`, `shape`, and `cells`.

- Pick by `whenToUse` and `purposes` (Problem Discovery, Analysis, Idea Generation, Strategy Planning, Business Improvement, Organization Development, Information Sharing).
- Before you draw a frame the person did not name, say in one line what it is for and ask if they want it.
- If the person names a framework ("show me a 3C"), draw it at once.
- If it is not in the data, use the nearest `shape` with your own `cells`, and say that it is not in the list.
- An entry with `skill` has no frame here: run that skill of this plugin instead.

## Writing in the frame

- When the person says something in the talk that belongs in a cell, write their words there yourself, unchanged, and tell them ("I wrote it in for you"). Do not make them copy it. Write no idea of your own into the frame.
- When a frame is full, you may write a short summary next to it that only reorders the person's words.
- Words that fit no place of the frame go, as they were said, into a "Notes" area beside it (in the person's language with the English word).
- You may write sums, rankings, and counts of the person's own values; they add no idea of yours.
- To find which place a text the person wrote belongs to, give its position minus the frame's `at` to `node "SKILL_DIR/scripts/frame.js" --locate <spec file> <x> <y>`.

## Draw

Frames are lines, not boxes, so the person can write anywhere. A 2-axis framework is a plus sign of two double-headed arrows with the four labels in the outer corners, mirrored. Tables have no outer frame. Titles are XL, labels L, the person's text M.

Every frame has a gray guide under the title and gray examples in its empty places. Keep the two apart:

- The guide explains: what the frame is for and what goes in each place ("Can: what you are able to do").
- An example is a sample answer, the kind of content that goes in that place, written as the person would write it ("e.g. good at drawing" in Can, not "e.g. what people praise you for"). Check that it reads right in its place: "I can <example>". Take it from a scene other than the person's own, so it shows the form without giving the answer. Keep it short, start it with "e.g." in the person's language, and do not let it steer the person's answer.

When the person has written in a place, or says they understand, delete the example of that place (`delete_items`, id `<prefix>-exN`).

Labels are in the person's language with the English term beside it. The data has English and Japanese labels: for a Japanese speaker use them as they are; for an English speaker keep only the English part (`--lang en` gives the English title and guide); for another language translate the Japanese part.

1. Get the spec of a framework from the data:

   ```
   node "SKILL_DIR/scripts/frame.js" --spec <id> [--lang en]
   ```

   It prints `{ shape, prefix, title, guide, ...cells }`. Write it to a file in your scratchpad. Change the labels if needed, and add `"examples"`: a list of texts, one per writable place, in slot order ("" leaves a place blank). To see the places of a spec:

   ```
   node "SKILL_DIR/scripts/frame.js" --slots <file>
   ```

   For a frame of your own, write the spec yourself; the shapes and their cells are described in the comments of `scripts/frame.js`.
2. Make the Skeletons: `node "SKILL_DIR/scripts/frame.js" <file>`. To draw the same framework twice, use a new `prefix` (1 to 12 letters, digits or _).
3. Find free space: `read_board` with `fields` `["id","x","y","width","height"]`. Place the frame to the right of the items there, with a gap of about 300 px.
4. Call `draw_skeletons` with the output as `elements` and the free place as `at`. `at` is added to the coordinates of the elements; the frame starts at 0,0, so `at` is where its top left corner lands.
5. Call `take_screenshot` once with `focusId` set to `<prefix>-title` and look for texts that touch or cross a line or another text. Move each one into free space inside its place with `edit_items` (`dx`, `dy`), or make it shorter, until nothing overlaps. A wide shot can miss lines and texts that are on the board; trust `read_board` when they disagree.

When you write the person's words into a frame, put them at the slot of that place (`--slots`) with `draw_skeletons` (a text, M size, the frame color) and check for overlaps the same way.

To change a frame ("add a level", "split this branch into three"), read what the person wrote, edit the spec, delete the old frame (its ids start with the prefix), draw it again in the same place, and put their words back.

## Do not

- Do not use `draw_table` for frames: it draws boxes.
- Do not judge the person's answers as right or wrong.
