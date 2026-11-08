# comment-lint

A lint for the comments of JavaScript files (`.js`, `.cjs`, `.mjs`). It checks the six items that the
review standard marks as checked by machine (lint).

**Standard:** GoodRelax/gr-sw-maker, branch `main`, commit `51958f0`,
`process-rules/review-standards-ja.md`, version `2026-11-08T10:11:13+09:00`
(R3 "Comments" section, lines 427 to 443; R7 "`@purity` tag", lines 722 to 742; checklist lines 877 to 881 and 906).
The same version is printed on the first line of every report.

Test code is under the R3 comment rules like product code: since 51958f0 the `Spec` kind is written
"when implementing a behavior of the specification, and when testing it", so a test cites the ID of the
behavior it tests with `// Spec: <ID>`. There is no Gherkin kind. Only the `@purity` rule exempts test
code (R7, "`@purity` tag" exclusions).

## Usage

```bash
npm run lint:comments
```

```bash
node tools/comment-lint/cli.js [--json] [--config <file>] [--no-baseline] [--update-baseline] [file or folder ...]
```

- Without a file or folder, the `paths` of the config are checked (`skills`, `test`, `tools/comment-lint`).
- Folders are walked for `.js`, `.cjs` and `.mjs`; the `exclude` globs of the config skip files and
  folders found by the walk (a file named on the command line is always checked).
- `.mjs` is parsed as a module, `.cjs` as a script, and `.js` as a script, then as a module if that fails.

Output, one line per violation, then one total line:

```text
comment-lint 1.0.0 standard GoodRelax/gr-sw-maker@51958f0 process-rules/review-standards-ja.md version 2026-11-08T10:11:13+09:00
skills/x/a.js:12:4: R3-comment-kind comment does not start with a kind (...)
1 violations in 1 of 3 files (R3-comment-kind 1, R3-comment-spec 0, R3-comment-summary 0, R3-comment-temporary 0, R7-purity-tag 0)
```

`--json` prints the same content as one JSON document (`standard`, `violations` with `file`, `line`,
`column`, `rule`, `check`, `severity`, `message`, then `totals`, `errors` and `baseline`).
All output is ASCII.

| Exit code | Meaning |
|:---|:---|
| 0 | No violation (with a baseline: no file/rule count above the baseline) |
| 1 | Violations (with a baseline: some file/rule count rose above the baseline) |
| 2 | A tool error: bad option, unreadable path, bad config, missing spec file, a file that does not parse |

## Rules

The standard does not number its items, so a rule ID is the name of its row in the review checklist.
The output must be ASCII, so each row has an ASCII alias. The row names below are quoted from the
standard as they are (Japanese).

| Alias in the output | Checklist row (rule ID) | Severity | Checklist line | Checks |
|:---|:---|:---|:---|:---|
| `R3-comment-kind` | `R3 コメント（種類）` | MUST | 877 | `check: kind` and `check: english` |
| `R3-comment-spec` | `R3 コメント（Spec）` | MUST | 879 | Spec ID exists |
| `R3-comment-summary` | `R3 コメント（Summary）` | SHOULD | 880 | Summary sentences |
| `R3-comment-temporary` | `R3 コメント（Temporary）` | MUST | 881 | Temporary has `Until:` |
| `R7-purity-tag` | `R7 @purity タグ` | MUST | 906 | One `@purity` tag with one of 4 values |

### What each rule judges, and the sentence of the standard it follows

1. **Kind** (`R3-comment-kind`, `check: kind`).
   Standard (lint item 1): 「すべてのコメントが上の種類で始まっているか」 - every comment starts with one of the kinds.
   Kinds: `Why:`, `Spec:`, `Summary:`, `Temporary:`, and the R7 comments `@purity`, `Section:`,
   `Consistency:`, plus the extra kinds of the config. A line with no kind continues the unit above it
   (see decision a); a line with no kind and no unit to continue is a violation, reported once per block
   of adjacent such lines.
2. **English** (`R3-comment-kind`, `check: english`).
   Standard (lint item 2): 「コメントが英語か」 - the comment is in English.
   Approximated by ASCII: a comment line with a character other than tab and `0x20`-`0x7E` is a
   violation, reported once per comment at the first such character. String literals are not comments
   and are not checked.
3. **Spec** (`R3-comment-spec`).
   Standard (lint item 3): 「`Spec` の ID が仕様書に実在するか」 - the `Spec` ID exists in the specification.
   Every ID in a `Spec:` unit (pattern from the config) must appear in one of the spec files; a `Spec:`
   unit with no ID of that pattern is also a violation. This applies to test code too.
4. **Summary** (`R3-comment-summary`, SHOULD).
   Standard (lint item 4): 「`Summary` が 3 文以下で、2 文以上なら `Temporary` があるか」 - a Summary has at
   most 3 sentences, and one of 2 or more has a Temporary.
   4 or more sentences is a violation; 2 or 3 sentences without a `Temporary:` unit on the line right after
   the Summary unit is a violation.
5. **Temporary** (`R3-comment-temporary`).
   Standard (lint item 5): 「`Temporary` に `Until:` があるか」 - a Temporary has `Until:`.
   Also, from the checklist row, a reason before `Until:` and a condition after it.
6. **@purity** (`R7-purity-tag`).
   Standard (lint item 6): 「R7 の `@purity` タグの決まりどおりに、`@purity` タグがあるか」, and R7:
   「すべての関数/メソッドは ... `@purity` タグをちょうど 1 つ持つ。値は次の 4 値のいずれか」 - every function
   and method has exactly one tag, valued `pure`, `semi-pure-immutable`, `semi-pure-mutable` or `non-pure`.
   Violations: no tag, 2 or more tags, no value, an unknown value, a legacy value (`semi-pure`,
   `semi-pure-a`, `semi-pure-b`), and a tag attached to no function.

### Decisions (a to d of the standard team)

- **a) Kinds and units.** A run is a set of `//` comments on adjacent lines with no code before them on
  their lines; a block comment, a JSDoc comment and a trailing comment are each a run of their own. In a
  run, a line that starts with a kind starts a unit; a line without a kind joins the unit above it, as in
  the three-sentence Summary example of the standard (lines 427 to 432). Units of `@purity`, `Section:`
  and the extra kinds are one line only. In a JSDoc comment, lines that start with a JSDoc tag
  (`@param`, `@returns`, ...) are allowed, while the description needs a kind. Sentences are counted in
  the whole Summary unit, at `.`, `!` or `?` followed by a space or the end, after dropping code spans,
  double-quoted strings and the abbreviations e.g., i.e., etc., vs., cf., approx. The Temporary of a
  Summary must start on the line right after the Summary unit.
- **b) Extra kinds** come from `extraKinds` in the config (regular expressions on the text after the
  comment opener). This repository allows eslint directives, `@ts-` directives and
  `SPDX-License-Identifier:`. A shebang is allowed with `allowShebang`, and the first run of a file is
  skipped as a license header when it matches `licenseHeaderPattern`.
- **c) Spec files and IDs** come from `spec.files` and `spec.idPattern`. Here: `docs/spec-en.md` and
  `docs/design-060-mcp-en.md`, IDs `FR-`, `NFR-`, `ADR-`, `SC-`, `IC-`, `UAT-` with three digits and an
  optional letter (`FR-009a`). An ID "exists" when it appears anywhere in a spec file.
- **d) @purity.** A function is a function declaration, a function expression, an arrow function or a
  method (class, object, getter, setter, constructor). Its tags are the comments between the previous
  token and its statement (`function`, `const f = ...`, `module.exports.f = ...`, `export ...`, a method or
  property key), plus the comments before the first statement of its body. A tag is a comment line that
  starts with `@purity`; a mention of `@purity` inside a sentence is not a tag. Exclusions: test code
  (`purity.exclude` globs: `test/**`, `**/*.test.js`, ...), generated and vendored code (`exclude` globs,
  skipped by every rule), and single-expression lambdas (`purity.exemptSingleExpressionLambdas`): an
  arrow with an expression body, or a function expression or arrow that is not a method and whose body
  is empty or one expression or `return` statement. Legacy values are violations even in excluded test
  code.

## Config

`tools/comment-lint/comment-lint.config.json` (paths are relative to `root`, which is relative to the
config file):

| Key | Meaning |
|:---|:---|
| `root` | Base folder of all other paths and of the file names in the baseline |
| `paths` | What to check when no file or folder is given |
| `exclude` | Globs skipped by the folder walk: dependencies, generated and vendored code |
| `extraKinds` | `[{ "name", "pattern", "continues"? }]` more kinds; `continues` lets the next lines join the unit |
| `allowShebang` | Allow `#!` on the first line (default true) |
| `licenseHeaderPattern` | Skip the first comment run of a file when it matches |
| `spec.files`, `spec.idPattern` | Specification files and the ID pattern (decision c) |
| `purity.exclude` | Globs of test code, where a missing tag is not a violation |
| `purity.exemptSingleExpressionLambdas` | Exempt single-expression lambdas (default true) |
| `baseline` | The baseline file of the ratchet |

## Baseline (ratchet)

`baseline.json` holds the count of violations per file and rule. A run fails (exit 1) only when a count
rises above its baseline, and prints only the violations of those file/rule pairs. When a count falls,
the total line says so; run `--update-baseline` to lower the baseline. `--no-baseline` prints every
violation.

Counts at `develop` 046a253 (53 existing files in `skills` and `test`, before the comment fix):

| Rule | Product code | Test code | Total |
|:---|---:|---:|---:|
| `R3-comment-kind` (kind) | 426 | 93 | 519 |
| `R3-comment-kind` (english) | 0 | 0 | 0 |
| `R3-comment-spec` | 1 | 0 | 1 |
| `R3-comment-summary` | 0 | 0 | 0 |
| `R3-comment-temporary` | 0 | 0 | 0 |
| `R7-purity-tag` | 220 | 0 | 220 |

`R7-purity-tag` 220 = 191 missing tags + 28 legacy values + 1 function with two tags.

## Design (for ports)

The judging core does not depend on a parser, so it can be copied to Python or TypeScript:

| File | Role | Parser |
|:---|:---|:---|
| `lib/units.js` | Groups comments into runs and kind units | no |
| `lib/rules/kind.js`, `english.js`, `spec.js`, `summary.js`, `temporary.js`, `purity.js` | One rule each | no |
| `lib/judge.js` | Runs all rules on one file | no |
| `lib/config.js`, `lib/glob.js`, `lib/baseline.js`, `lib/format.js`, `lib/standard.js` | Config, globs, ratchet, output, standard version | no |
| `lib/acorn-adapter.js` | Reads comments and function sites from source with acorn | **yes** |
| `cli.js` | Files, arguments, exit codes | no |

The core takes, per file:

- `comments`: `[{ line, column, endLine, style, text, isTrailing }]`, where `style` is `line`, `block`,
  `jsdoc` or `hashbang`, `text` is the comment without `//`, `/*`, `*/`, and `line` and `column` are
  1-based positions of the opener.
- `functions`: `[{ line, column, name, isSingleExpression, commentIndexes }]`, where `commentIndexes`
  are the indexes in `comments` of the comments attached to the function (decision d).

and returns `[{ rule, check?, line, column, message }]`. Only the adapter reads a syntax tree; reading
comments (`readComments`) and reading function sites (`readFunctionSites`) are separate functions.

The fixtures in `fixtures/` are a self-contained set of passing and failing files with
`expected.json`; see `fixtures/README.md`. Tests: `node --test` (from the repository root) runs
`tools/comment-lint/test/*.test.js`.

acorn is a devDependency of the root `package.json` (exact version).
