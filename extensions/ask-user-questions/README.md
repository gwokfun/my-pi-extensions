# Ask User Questions

`ask_user_questions` is a Pi-native tool for collecting a small set of decisions without turning the conversation into a long clarification loop. It is based on Pi 0.84.1's `question.ts` and `questionnaire.ts` examples, with a more compact review-oriented overlay.

## Features

- one to three questions in one blocking interaction;
- single-select and multi-select questions;
- two to five choices per question, with descriptions and recommended badges;
- an optional custom answer added by the UI;
- progress navigation, quick number keys, preserved answers, and a final review page for multi-question forms;
- structured result details plus a concise model-facing summary;
- safe cancellation and a clear non-TUI error instead of hanging in print/JSON/RPC mode.

## Tool input

```json
{
  "questions": [
    {
      "id": "scope",
      "header": "Scope",
      "question": "Which delivery scope should we use?",
      "options": [
        {
          "label": "Focused change",
          "value": "focused",
          "description": "Keep the review surface narrow.",
          "recommended": true
        },
        {
          "label": "Complete pass",
          "value": "complete",
          "description": "Include all related cleanup now."
        }
      ]
    },
    {
      "id": "checks",
      "header": "Checks",
      "question": "Which verification should be included?",
      "multiSelect": true,
      "allowOther": true,
      "options": [
        { "label": "Unit tests" },
        { "label": "Smoke tests" },
        { "label": "Manual TUI run" }
      ]
    }
  ]
}
```

Question IDs must be unique `snake_case` values. Do not include an `Other` choice: the overlay appends **Write a custom answer** unless `allowOther` is `false`.

## Controls

| Key | Action |
|---|---|
| `↑` / `↓`, `j` / `k` | Move through choices or review rows |
| `1`–`6` | Choose/toggle an option directly |
| `Enter` / `Space` | Select a single choice |
| `Space` | Toggle a choice in multi-select mode |
| `Enter` | Continue after multi-select, or edit/submit on the review page |
| `Tab` / `→` | Move to the next question |
| `Shift+Tab` / `←` | Move to the previous question |
| `Esc` twice | Cancel while protecting against an accidental first press |
| `Ctrl+C` | Cancel immediately |

Inside the custom-answer editor, `Enter` submits the text and `Esc` returns to the choices.

## Result contract

The text result tells the agent what the user selected. `details` preserves normalized questions and ordered answers:

```json
{
  "questions": [],
  "answers": [
    {
      "id": "scope",
      "header": "Scope",
      "choices": [
        {
          "label": "Focused change",
          "value": "focused",
          "custom": false,
          "optionIndex": 0
        }
      ]
    }
  ],
  "cancelled": false
}
```

Cancellation is a user decision, not a tool error. Invalid input, UI failures, and non-TUI execution return `isError: true`.

## Verification

```bash
npm test
npm run smoke
npm run verify:stock-pi
```

The automated checks exercise validation, answer semantics, rendering, keyboard selection, review submission, and non-interactive rejection. A real interactive Pi run is still required to assess terminal-specific colors, IME placement, and visual feel.
