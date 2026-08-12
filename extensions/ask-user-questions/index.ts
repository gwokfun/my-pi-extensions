import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	answerIsComplete,
	buildResult,
	formatAnswersForModel,
	MAX_DESCRIPTION_LENGTH,
	MAX_HEADER_LENGTH,
	MAX_LABEL_LENGTH,
	MAX_OPTIONS,
	MAX_QUESTION_LENGTH,
	MAX_QUESTIONS,
	MIN_OPTIONS,
	MIN_QUESTIONS,
	normalizeQuestions,
	type AskQuestion,
	type AskQuestionInput,
	type AskUserQuestionsResult,
} from "./logic.ts";
import { openAskUserQuestions } from "./viewer.ts";

const OptionSchema = Type.Object({
	label: Type.String({
		description: "Short user-facing option label",
		minLength: 1,
		maxLength: MAX_LABEL_LENGTH,
	}),
	description: Type.Optional(
		Type.String({
			description: "One concise sentence explaining the impact or tradeoff",
			minLength: 1,
			maxLength: MAX_DESCRIPTION_LENGTH,
		}),
	),
	value: Type.Optional(
		Type.String({
			description: "Stable value returned to the agent; defaults to label",
			minLength: 1,
			maxLength: MAX_LABEL_LENGTH,
		}),
	),
	recommended: Type.Optional(
		Type.Boolean({ description: "Show a Recommended badge. Single-select questions may recommend at most one option." }),
	),
});

const QuestionSchema = Type.Object({
	id: Type.String({
		description: "Stable snake_case identifier, for example output_format",
		pattern: "^[a-z][a-z0-9_]*$",
		minLength: 1,
		maxLength: 32,
	}),
	header: Type.String({
		description: "Short section label shown in progress navigation",
		minLength: 1,
		maxLength: MAX_HEADER_LENGTH,
	}),
	question: Type.String({
		description: "The complete question shown to the user",
		minLength: 1,
		maxLength: MAX_QUESTION_LENGTH,
	}),
	options: Type.Array(OptionSchema, {
		description: "Choices; do not add an Other option because the UI provides it when allowed",
		minItems: MIN_OPTIONS,
		maxItems: MAX_OPTIONS,
	}),
	multiSelect: Type.Optional(
		Type.Boolean({ description: "Allow several choices. Defaults to false (single choice)." }),
	),
	allowOther: Type.Optional(
		Type.Boolean({ description: "Append a custom-answer choice. Defaults to true." }),
	),
});

const AskUserQuestionsParams = Type.Object({
	questions: Type.Array(QuestionSchema, {
		description: "A small set of independent questions to ask in one interaction",
		minItems: MIN_QUESTIONS,
		maxItems: MAX_QUESTIONS,
	}),
});

function errorResult(message: string, questions: AskQuestion[] = []) {
	const details = buildResult(questions, new Map(), true);
	return {
		content: [{ type: "text" as const, text: `Ask User Questions error: ${message}` }],
		details,
		isError: true,
	};
}

export default function askUserQuestionsExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "ask_user_questions",
		label: "Ask User Questions",
		description:
			"Ask the user 1-3 concise multiple-choice questions in a polished interactive overlay. Supports single-select, multi-select, recommended choices, descriptions, and a custom answer. Use when a user decision is required before proceeding.",
		promptSnippet: "Ask the user up to three structured questions in one interactive form",
		promptGuidelines: [
			"Use ask_user_questions only when the answer cannot be inferred safely from the request or repository.",
			"Ask 1-3 focused questions. Give each 2-5 concrete options with concise impact descriptions.",
			"For single-select questions, mark at most one option recommended when you have a defensible default.",
			"Do not include an Other option yourself; the UI adds a custom-answer choice unless allowOther is false.",
		],
		parameters: AskUserQuestionsParams,
		executionMode: "sequential",

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			let questions: AskQuestion[];
			try {
				questions = normalizeQuestions(params.questions as AskQuestionInput[]);
			} catch (error) {
				return errorResult(error instanceof Error ? error.message : String(error));
			}

			if (ctx.mode !== "tui") {
				return errorResult("interactive TUI mode is required; no question was shown.", questions);
			}

			try {
				const result = await openAskUserQuestions(ctx, questions, signal);
				return {
					content: [{ type: "text" as const, text: formatAnswersForModel(result) }],
					details: result,
				};
			} catch (error) {
				return errorResult(error instanceof Error ? error.message : String(error), questions);
			}
		},

		renderCall(args, theme) {
			const questions = (args.questions ?? []) as AskQuestionInput[];
			const lines = [
				theme.fg("toolTitle", theme.bold("ask_user_questions ")) +
					theme.fg("muted", `${questions.length} question${questions.length === 1 ? "" : "s"}`),
			];
			for (const [index, question] of questions.entries()) {
				const mode = question.multiSelect ? "multi" : "single";
				lines.push(
					`${theme.fg("muted", `${index + 1}.`)} ${theme.fg("accent", question.header || question.id || "Question")} ${theme.fg("dim", `[${mode}] ${truncateToWidth(question.question ?? "", 72, "…")}`)}`,
				);
			}
			return new Text(lines.join("\n"), 0, 0);
		},

		renderResult(result, _options, theme, context) {
			const details = result.details as AskUserQuestionsResult | undefined;
			if (!details) {
				const content = result.content[0];
				return new Text(content?.type === "text" ? content.text : "", 0, 0);
			}
			if (context.isError) {
				const content = result.content[0];
				return new Text(theme.fg("error", content?.type === "text" ? content.text : "Ask User Questions failed"), 0, 0);
			}
			if (details.cancelled) {
				const completed = details.answers.filter(answerIsComplete).length;
				return new Text(
					theme.fg("warning", "Cancelled") + theme.fg("dim", completed ? ` · ${completed}/${details.questions.length} answered` : ""),
					0,
					0,
				);
			}

			const lines = details.answers.map((answer) => {
				const choices = answer.choices
					.map((choice) => `${choice.custom ? theme.fg("muted", "custom: ") : ""}${choice.label}`)
					.join(theme.fg("dim", ", "));
				return `${theme.fg("success", "✓")} ${theme.fg("accent", answer.header)}${theme.fg("dim", ` (${answer.id})`)}: ${choices}`;
			});
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
