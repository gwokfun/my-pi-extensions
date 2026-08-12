import assert from "node:assert/strict";
import test from "node:test";
import {
	answerIsComplete,
	answerSummary,
	buildResult,
	customAnswer,
	emptyAnswer,
	formatAnswersForModel,
	normalizeQuestions,
	selectOption,
	selectedOptionIndexes,
	setCustomAnswer,
} from "./logic.ts";

test("normalizes defaults and preserves recommended option metadata", () => {
	const [question] = normalizeQuestions([
		{
			id: "delivery_mode",
			header: "Delivery",
			question: "How should this be delivered?",
			options: [
				{ label: "Small PR", value: "small_pr", description: "Keep the review surface narrow.", recommended: true },
				{ label: "One commit", description: "Deliver everything together." },
			],
		},
	]);

	assert.equal(question.id, "delivery_mode");
	assert.equal(question.multiSelect, false);
	assert.equal(question.allowOther, true);
	assert.deepEqual(question.options[0], {
		label: "Small PR",
		value: "small_pr",
		description: "Keep the review surface narrow.",
		recommended: true,
	});
	assert.equal(question.options[1].value, "One commit");
});

test("rejects malformed question sets before opening the UI", () => {
	assert.throws(() => normalizeQuestions([]), /between 1 and 3 questions/);
	assert.throws(
		() =>
			normalizeQuestions([
				{
					id: "Not-Snake",
					header: "Bad",
					question: "Invalid id?",
					options: [{ label: "Yes" }, { label: "No" }],
				},
			]),
		/snake_case/,
	);
	assert.throws(
		() =>
			normalizeQuestions([
				{
					id: "duplicate",
					header: "Duplicate",
					question: "Which one?",
					options: [{ label: "Same" }, { label: "same" }],
				},
			]),
		/duplicate option label/,
	);
	assert.throws(
		() =>
			normalizeQuestions([
				{
					id: "recommendation",
					header: "Default",
					question: "Which default?",
					options: [
						{ label: "A", recommended: true },
						{ label: "B", recommended: true },
					],
				},
			]),
		/only have one recommended option/,
	);
});

test("single-select replaces its answer while multi-select toggles choices", () => {
	const [single, multi] = normalizeQuestions([
		{
			id: "format",
			header: "Format",
			question: "Which format?",
			options: [{ label: "Markdown" }, { label: "JSON" }],
		},
		{
			id: "checks",
			header: "Checks",
			question: "Which checks?",
			multiSelect: true,
			options: [{ label: "Unit" }, { label: "Smoke" }, { label: "Manual" }],
		},
	]);

	let singleAnswer = selectOption(emptyAnswer(single), single, 0);
	singleAnswer = selectOption(singleAnswer, single, 1);
	assert.deepEqual(singleAnswer.choices.map((choice) => choice.label), ["JSON"]);

	let multiAnswer = selectOption(emptyAnswer(multi), multi, 0);
	multiAnswer = selectOption(multiAnswer, multi, 2);
	assert.deepEqual([...selectedOptionIndexes(multiAnswer)], [0, 2]);
	multiAnswer = selectOption(multiAnswer, multi, 0);
	assert.deepEqual([...selectedOptionIndexes(multiAnswer)], [2]);
});

test("custom answers replace a single choice and coexist with multi-select choices", () => {
	const [single, multi] = normalizeQuestions([
		{
			id: "single_other",
			header: "Single",
			question: "Choose one",
			options: [{ label: "A" }, { label: "B" }],
		},
		{
			id: "multi_other",
			header: "Multi",
			question: "Choose several",
			multiSelect: true,
			options: [{ label: "A" }, { label: "B" }],
		},
	]);

	const singleAnswer = setCustomAnswer(selectOption(emptyAnswer(single), single, 0), single, "A different answer");
	assert.equal(customAnswer(singleAnswer), "A different answer");
	assert.deepEqual(singleAnswer.choices.map((choice) => choice.label), ["A different answer"]);

	const multiAnswer = setCustomAnswer(selectOption(emptyAnswer(multi), multi, 0), multi, "Also this");
	assert.deepEqual(multiAnswer.choices.map((choice) => choice.label), ["A", "Also this"]);
	assert.equal(answerSummary(multiAnswer), "A, Also this");
});

test("builds ordered structured details and an unambiguous model-facing summary", () => {
	const questions = normalizeQuestions([
		{
			id: "scope",
			header: "Scope",
			question: "Which scope?",
			options: [
				{ label: "MVP", value: "mvp" },
				{ label: "Complete", value: "complete" },
			],
		},
	]);
	const answer = selectOption(emptyAnswer(questions[0]), questions[0], 0);
	const result = buildResult(questions, new Map([[answer.id, answer]]), false);

	assert.equal(answerIsComplete(result.answers[0]), true);
	assert.match(formatAnswersForModel(result), /scope \(Scope\): MVP \[mvp\]/);
	assert.equal(formatAnswersForModel({ ...result, cancelled: true }), "User cancelled the questionnaire after answering 1/1 questions.");
});
