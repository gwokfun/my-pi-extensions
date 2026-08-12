export const MIN_QUESTIONS = 1;
export const MAX_QUESTIONS = 3;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 5;
export const MAX_HEADER_LENGTH = 24;
export const MAX_QUESTION_LENGTH = 1_000;
export const MAX_LABEL_LENGTH = 80;
export const MAX_DESCRIPTION_LENGTH = 300;
export const MAX_CUSTOM_ANSWER_LENGTH = 4_000;

export interface AskQuestionOptionInput {
	label: string;
	description?: string;
	value?: string;
	recommended?: boolean;
}

export interface AskQuestionInput {
	id: string;
	header: string;
	question: string;
	options: AskQuestionOptionInput[];
	multiSelect?: boolean;
	allowOther?: boolean;
}

export interface AskQuestionOption {
	label: string;
	description?: string;
	value: string;
	recommended: boolean;
}

export interface AskQuestion {
	id: string;
	header: string;
	question: string;
	options: AskQuestionOption[];
	multiSelect: boolean;
	allowOther: boolean;
}

export interface AskAnswerChoice {
	value: string;
	label: string;
	custom: boolean;
	optionIndex?: number;
}

export interface AskAnswer {
	id: string;
	header: string;
	choices: AskAnswerChoice[];
}

export interface AskUserQuestionsResult {
	questions: AskQuestion[];
	answers: AskAnswer[];
	cancelled: boolean;
}

export class AskUserQuestionsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AskUserQuestionsError";
	}
}

function cleanRequired(value: unknown, field: string, maxLength: number): string {
	if (typeof value !== "string") throw new AskUserQuestionsError(`${field} must be a string.`);
	const cleaned = value.trim();
	if (!cleaned) throw new AskUserQuestionsError(`${field} cannot be empty.`);
	if ([...cleaned].length > maxLength) {
		throw new AskUserQuestionsError(`${field} must be at most ${maxLength} characters.`);
	}
	return cleaned;
}

function cleanOptional(value: unknown, field: string, maxLength: number): string | undefined {
	if (value === undefined) return undefined;
	const cleaned = cleanRequired(value, field, maxLength);
	return cleaned || undefined;
}

export function normalizeQuestions(input: readonly AskQuestionInput[]): AskQuestion[] {
	if (!Array.isArray(input)) throw new AskUserQuestionsError("questions must be an array.");
	if (input.length < MIN_QUESTIONS || input.length > MAX_QUESTIONS) {
		throw new AskUserQuestionsError(`Provide between ${MIN_QUESTIONS} and ${MAX_QUESTIONS} questions.`);
	}

	const ids = new Set<string>();
	return input.map((question, questionIndex) => {
		const field = `questions[${questionIndex}]`;
		const id = cleanRequired(question?.id, `${field}.id`, 32);
		if (!/^[a-z][a-z0-9_]*$/.test(id)) {
			throw new AskUserQuestionsError(`${field}.id must use snake_case and start with a lowercase letter.`);
		}
		if (ids.has(id)) throw new AskUserQuestionsError(`Question id "${id}" is duplicated.`);
		ids.add(id);

		const header = cleanRequired(question?.header, `${field}.header`, MAX_HEADER_LENGTH);
		const prompt = cleanRequired(question?.question, `${field}.question`, MAX_QUESTION_LENGTH);
		if (!Array.isArray(question?.options)) throw new AskUserQuestionsError(`${field}.options must be an array.`);
		if (question.options.length < MIN_OPTIONS || question.options.length > MAX_OPTIONS) {
			throw new AskUserQuestionsError(`${field}.options must contain between ${MIN_OPTIONS} and ${MAX_OPTIONS} items.`);
		}

		const labels = new Set<string>();
		const values = new Set<string>();
		const options = question.options.map((option, optionIndex) => {
			const optionField = `${field}.options[${optionIndex}]`;
			const label = cleanRequired(option?.label, `${optionField}.label`, MAX_LABEL_LENGTH);
			const value = cleanOptional(option?.value, `${optionField}.value`, MAX_LABEL_LENGTH) ?? label;
			const labelKey = label.toLocaleLowerCase();
			if (labels.has(labelKey)) throw new AskUserQuestionsError(`${field} contains duplicate option label "${label}".`);
			if (values.has(value)) throw new AskUserQuestionsError(`${field} contains duplicate option value "${value}".`);
			labels.add(labelKey);
			values.add(value);
			return {
				label,
				value,
				description: cleanOptional(option?.description, `${optionField}.description`, MAX_DESCRIPTION_LENGTH),
				recommended: option?.recommended === true,
			};
		});

		const multiSelect = question.multiSelect === true;
		if (!multiSelect && options.filter((option) => option.recommended).length > 1) {
			throw new AskUserQuestionsError(`${field} is single-select and may only have one recommended option.`);
		}

		return {
			id,
			header,
			question: prompt,
			options,
			multiSelect,
			allowOther: question.allowOther !== false,
		};
	});
}

export function emptyAnswer(question: AskQuestion): AskAnswer {
	return { id: question.id, header: question.header, choices: [] };
}

export function answerIsComplete(answer: AskAnswer | undefined): boolean {
	return Boolean(answer && answer.choices.length > 0);
}

export function selectOption(answer: AskAnswer, question: AskQuestion, optionIndex: number): AskAnswer {
	const option = question.options[optionIndex];
	if (!option) throw new AskUserQuestionsError(`Option ${optionIndex + 1} does not exist for ${question.id}.`);
	const choice: AskAnswerChoice = {
		value: option.value,
		label: option.label,
		custom: false,
		optionIndex,
	};
	if (!question.multiSelect) return { ...answer, choices: [choice] };
	const selected = answer.choices.some((candidate) => candidate.optionIndex === optionIndex && !candidate.custom);
	return {
		...answer,
		choices: selected
			? answer.choices.filter((candidate) => candidate.custom || candidate.optionIndex !== optionIndex)
			: [...answer.choices, choice],
	};
}

export function setCustomAnswer(answer: AskAnswer, question: AskQuestion, text: string): AskAnswer {
	if (!question.allowOther) throw new AskUserQuestionsError(`Question ${question.id} does not allow a custom answer.`);
	const cleaned = cleanRequired(text, `Custom answer for ${question.id}`, MAX_CUSTOM_ANSWER_LENGTH);
	const choice: AskAnswerChoice = { value: cleaned, label: cleaned, custom: true };
	if (!question.multiSelect) return { ...answer, choices: [choice] };
	return { ...answer, choices: [...answer.choices.filter((candidate) => !candidate.custom), choice] };
}

export function selectedOptionIndexes(answer: AskAnswer | undefined): Set<number> {
	return new Set(
		(answer?.choices ?? [])
			.filter((choice): choice is AskAnswerChoice & { optionIndex: number } => !choice.custom && choice.optionIndex !== undefined)
			.map((choice) => choice.optionIndex),
	);
}

export function customAnswer(answer: AskAnswer | undefined): string | undefined {
	return answer?.choices.find((choice) => choice.custom)?.value;
}

export function answerSummary(answer: AskAnswer | undefined, maxLength = 100): string {
	if (!answerIsComplete(answer)) return "Not answered";
	const text = answer!.choices.map((choice) => choice.label).join(", ");
	const characters = [...text];
	return characters.length <= maxLength ? text : `${characters.slice(0, Math.max(1, maxLength - 1)).join("")}…`;
}

export function buildResult(
	questions: AskQuestion[],
	answersById: ReadonlyMap<string, AskAnswer>,
	cancelled: boolean,
): AskUserQuestionsResult {
	return {
		questions,
		answers: questions.map((question) => answersById.get(question.id) ?? emptyAnswer(question)),
		cancelled,
	};
}

export function formatAnswersForModel(result: AskUserQuestionsResult): string {
	if (result.cancelled) {
		const completed = result.answers.filter(answerIsComplete).length;
		return completed > 0
			? `User cancelled the questionnaire after answering ${completed}/${result.questions.length} questions.`
			: "User cancelled the questionnaire without answering.";
	}
	const lines = result.answers.map((answer) => {
		const rendered = answer.choices
			.map((choice) => (choice.custom ? `custom: ${choice.value}` : choice.label === choice.value ? choice.label : `${choice.label} [${choice.value}]`))
			.join("; ");
		return `- ${answer.id} (${answer.header}): ${rendered}`;
	});
	return `User answered the questions:\n${lines.join("\n")}`;
}
