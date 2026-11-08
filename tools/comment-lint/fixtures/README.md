# comment-lint fixtures

A self-contained set of passing and failing sample files for the six comment checks of the review
standard GoodRelax/gr-sw-maker `process-rules/review-standards-ja.md`, commit `51958f0`, version
`2026-11-08T10:11:13+09:00`. Other teams may copy this folder as is to test their own port of the lint
(Python, TypeScript, or another parser); nothing in it depends on comment-lint's code.

## Contents

| Path | What it is |
|:---|:---|
| `comment-lint.config.json` | The config the fixtures are judged with (spec file, ID pattern, extra kind, purity exclusion) |
| `spec.md` | The specification the `Spec:` IDs are checked against (`FR-001`, `FR-002`, `NFR-001`) |
| `expected.json` | The expected violations of every fixture file, and the files that must fail to parse |
| `r3-kind/` | Comments that start with a kind, and comments that do not |
| `r3-english/` | Comments in ASCII, and comments with other characters |
| `r3-spec/` | `Spec:` IDs found in `spec.md`, missing, or absent |
| `r3-summary/` | `Summary:` of 1 to 3 sentences with `Temporary:`, and of too many sentences or with no `Temporary:` right after |
| `r3-temporary/` | `Temporary:` with and without a reason and `Until:` |
| `r7-purity/` | `@purity` on functions and methods: present once, missing, twice, legacy, unknown, empty, unattached; `*.excluded.js` stands for test code |
| `parsing/` | Shebang, license header, `.mjs` (module), `.cjs` (script), `.js` that falls back to a module, and a file that does not parse |

A file named `*.excluded.js` stands for test code: it is exempt from missing `@purity` tags only, and stays
under the R3 comment rules (`r3-spec/pass-spec-in-test.excluded.js`, `r3-kind/fail-in-test.excluded.js`).

File names start with `pass-` (no violation expected) or `fail-` (violations expected). `error-syntax.js`
is a tool error (exit code 2), not a violation.

## expected.json

```json
{
  "standard": { "repository": "...", "commit": "51958f0", "file": "...", "version": "..." },
  "config": "comment-lint.config.json",
  "errors": ["parsing/error-syntax.js"],
  "files": {
    "r3-kind/fail-untyped.js": [
      { "line": 3, "column": 4, "rule": "R3-comment-kind", "check": "kind" }
    ]
  }
}
```

- `line` and `column` are 1-based. A violation about a comment points at the first character of the
  comment text after `//`, `/*` or ` * ` and the following spaces; an English violation points at the
  first non-ASCII character; a missing or doubled `@purity` points at the start of the function's
  statement (for example `const`, `function`, the method name).
- `check` appears only for `R3-comment-kind`, which covers two checks of one checklist row: `kind` and
  `english`.
- A port that reports only `path:line` can compare `line` and `rule` and ignore `column`.
