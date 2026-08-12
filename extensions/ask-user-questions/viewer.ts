import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	parseKey,
	truncateToWidth,
	type TUI,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
	answerIsComplete,
	answerSummary,
	buildResult,
	customAnswer,
	emptyAnswer,
	MAX_CUSTOM_ANSWER_LENGTH,
	selectOption,
	selectedOptionIndexes,
	setCustomAnswer,
	type AskAnswer,
	type AskQuestion,
	type AskUserQuestionsResult,
} from "./logic.ts";

interface BodyLayout {
	lines: string[];
	activeStart: number;
	activeEnd: number;
}

export class AskUserQuestionsComponent {
	focused = false;

	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly questions: AskQuestion[];
	private readonly done: (result: AskUserQuestionsResult) => void;
	private readonly editor: Editor;
	private readonly answers = new Map<string, AskAnswer>();
	private readonly abortSignal?: AbortSignal;
	private readonly abortHandler: () => void;
	private currentQuestionIndex = 0;
	private optionIndex = 0;
	private reviewIndex = 0;
	private inputMode = false;
	private scrollOffset = 0;
	private bodyHeight = 6;
	private maxScroll = 0;
	private message = "";
	private cancelArmedUntil = 0;
	private cancelTimer: ReturnType<typeof setTimeout> | null = null;
	private completed = false;

	constructor(
		tui: TUI,
		theme: Theme,
		questions: AskQuestion[],
		done: (result: AskUserQuestionsResult) => void,
		abortSignal?: AbortSignal,
	) {
		this.tui = tui;
		this.theme = theme;
		this.questions = questions;
		this.done = done;
		for (const question of questions) this.answers.set(question.id, emptyAnswer(question));

		const editorTheme: EditorTheme = {
			borderColor: (text) => theme.fg("accent", text),
			selectList: {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			},
		};
		this.editor = new Editor(tui, editorTheme, { paddingX: 0, autocompleteMaxVisible: 4 });
		this.editor.onChange = () => this.refresh();
		this.editor.onSubmit = (text) => this.submitCustomAnswer(text);

		this.abortSignal = abortSignal;
		this.abortHandler = () => this.finish(true);
		if (abortSignal?.aborted) queueMicrotask(this.abortHandler);
		else abortSignal?.addEventListener("abort", this.abortHandler, { once: true });
	}

	dispose(): void {
		this.completed = true;
		this.abortSignal?.removeEventListener("abort", this.abortHandler);
		if (this.cancelTimer) clearTimeout(this.cancelTimer);
		this.cancelTimer = null;
	}

	invalidate(): void {
		this.editor.invalidate();
	}

	private currentQuestion(): AskQuestion | undefined {
		return this.questions[this.currentQuestionIndex];
	}

	private isReview(): boolean {
		return this.currentQuestionIndex === this.questions.length;
	}

	private answerFor(question: AskQuestion): AskAnswer {
		return this.answers.get(question.id) ?? emptyAnswer(question);
	}

	private setAnswer(answer: AskAnswer): void {
		this.answers.set(answer.id, answer);
	}

	private allAnswered(): boolean {
		return this.questions.every((question) => answerIsComplete(this.answers.get(question.id)));
	}

	private answeredCount(): number {
		return this.questions.filter((question) => answerIsComplete(this.answers.get(question.id))).length;
	}

	private refresh(): void {
		this.tui.requestRender();
	}

	private finish(cancelled: boolean): void {
		if (this.completed) return;
		this.completed = true;
		this.abortSignal?.removeEventListener("abort", this.abortHandler);
		if (this.cancelTimer) clearTimeout(this.cancelTimer);
		this.done(buildResult(this.questions, this.answers, cancelled));
	}

	private clearMessage(): void {
		this.message = "";
	}

	private showMessage(message: string): void {
		this.message = message;
		this.refresh();
	}

	private armCancel(): void {
		const now = Date.now();
		if (now < this.cancelArmedUntil) {
			this.finish(true);
			return;
		}
		this.cancelArmedUntil = now + 2_000;
		this.showMessage("Press Esc again to cancel the questionnaire.");
		if (this.cancelTimer) clearTimeout(this.cancelTimer);
		this.cancelTimer = setTimeout(() => {
			this.cancelArmedUntil = 0;
			if (this.message.startsWith("Press Esc again")) this.message = "";
			this.refresh();
		}, 2_050);
	}

	private displayOptionCount(question: AskQuestion): number {
		return question.options.length + Number(question.allowOther);
	}

	private restoreOptionIndex(question: AskQuestion): void {
		const answer = this.answerFor(question);
		const selected = answer.choices.find((choice) => choice.optionIndex !== undefined)?.optionIndex;
		this.optionIndex = selected ?? (customAnswer(answer) !== undefined ? question.options.length : 0);
		this.optionIndex = Math.min(this.optionIndex, this.displayOptionCount(question) - 1);
	}

	private goToQuestion(index: number): void {
		this.inputMode = false;
		this.clearMessage();
		this.scrollOffset = 0;
		this.currentQuestionIndex = Math.max(0, Math.min(this.questions.length, index));
		if (this.isReview()) {
			this.reviewIndex = this.questions.length;
		} else {
			this.restoreOptionIndex(this.currentQuestion()!);
		}
		this.refresh();
	}

	private moveTab(delta: number): void {
		const total = this.questions.length + Number(this.questions.length > 1);
		if (total <= 1) return;
		const current = this.isReview() ? this.questions.length : this.currentQuestionIndex;
		this.goToQuestion((current + delta + total) % total);
	}

	private advanceAfterAnswer(): void {
		if (this.currentQuestionIndex < this.questions.length - 1) {
			this.goToQuestion(this.currentQuestionIndex + 1);
			return;
		}
		if (this.questions.length === 1) {
			this.finish(false);
			return;
		}
		this.goToQuestion(this.questions.length);
	}

	private chooseOption(index: number): void {
		const question = this.currentQuestion();
		if (!question) return;
		this.optionIndex = Math.max(0, Math.min(this.displayOptionCount(question) - 1, index));
		this.clearMessage();
		if (this.optionIndex === question.options.length) {
			this.enterCustomInput(question);
			return;
		}

		const next = selectOption(this.answerFor(question), question, this.optionIndex);
		this.setAnswer(next);
		if (!question.multiSelect) this.advanceAfterAnswer();
		else this.refresh();
	}

	private enterCustomInput(question: AskQuestion): void {
		this.inputMode = true;
		this.clearMessage();
		this.editor.setText(customAnswer(this.answerFor(question)) ?? "");
		this.scrollOffset = 0;
		this.refresh();
	}

	private submitCustomAnswer(text: string): void {
		const question = this.currentQuestion();
		if (!question) return;
		const cleaned = text.trim();
		if (!cleaned) {
			this.showMessage("Custom answer cannot be empty.");
			return;
		}
		if ([...cleaned].length > MAX_CUSTOM_ANSWER_LENGTH) {
			this.showMessage(`Custom answer is limited to ${MAX_CUSTOM_ANSWER_LENGTH} characters.`);
			return;
		}
		this.setAnswer(setCustomAnswer(this.answerFor(question), question, cleaned));
		this.inputMode = false;
		this.editor.setText("");
		if (!question.multiSelect) this.advanceAfterAnswer();
		else this.showMessage("Custom answer added. Press Enter when your selections are complete.");
	}

	private leaveCustomInput(): void {
		this.inputMode = false;
		this.editor.setText("");
		this.clearMessage();
		this.refresh();
	}

	private continueMultiSelect(): void {
		const question = this.currentQuestion();
		if (!question) return;
		if (!answerIsComplete(this.answerFor(question))) {
			this.showMessage("Select at least one option before continuing.");
			return;
		}
		this.advanceAfterAnswer();
	}

	private handleQuestionInput(data: string): void {
		const question = this.currentQuestion();
		if (!question) return;
		const optionCount = this.displayOptionCount(question);

		if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
			this.optionIndex = (this.optionIndex - 1 + optionCount) % optionCount;
			this.clearMessage();
			this.refresh();
			return;
		}
		if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
			this.optionIndex = (this.optionIndex + 1) % optionCount;
			this.clearMessage();
			this.refresh();
			return;
		}

		const printable = parseKey(data) ?? (data.length === 1 ? data : undefined);
		if (printable && /^[1-6]$/.test(printable)) {
			const index = Number(printable) - 1;
			if (index < optionCount) this.chooseOption(index);
			return;
		}

		if (matchesKey(data, Key.space)) {
			this.chooseOption(this.optionIndex);
			return;
		}
		if (matchesKey(data, Key.enter)) {
			if (this.optionIndex === question.options.length && question.allowOther) {
				this.enterCustomInput(question);
			} else if (question.multiSelect) {
				this.continueMultiSelect();
			} else {
				this.chooseOption(this.optionIndex);
			}
		}
	}

	private handleReviewInput(data: string): void {
		const itemCount = this.questions.length + 1;
		if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
			this.reviewIndex = (this.reviewIndex - 1 + itemCount) % itemCount;
			this.clearMessage();
			this.refresh();
			return;
		}
		if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
			this.reviewIndex = (this.reviewIndex + 1) % itemCount;
			this.clearMessage();
			this.refresh();
			return;
		}
		const printable = parseKey(data) ?? (data.length === 1 ? data : undefined);
		if (printable && /^[1-3]$/.test(printable)) {
			const index = Number(printable) - 1;
			if (index < this.questions.length) this.goToQuestion(index);
			return;
		}
		if (!matchesKey(data, Key.enter)) return;
		if (this.reviewIndex < this.questions.length) {
			this.goToQuestion(this.reviewIndex);
			return;
		}
		if (!this.allAnswered()) {
			this.showMessage("Answer every question before submitting.");
			return;
		}
		this.finish(false);
	}

	handleInput(data: string): void {
		if (this.completed) return;
		if (this.inputMode) {
			if (matchesKey(data, Key.escape)) {
				this.leaveCustomInput();
				return;
			}
			if (matchesKey(data, Key.ctrl("c"))) {
				this.finish(true);
				return;
			}
			this.editor.handleInput(data);
			this.refresh();
			return;
		}

		if (matchesKey(data, Key.ctrl("c"))) {
			this.finish(true);
			return;
		}
		if (matchesKey(data, Key.escape)) {
			this.armCancel();
			return;
		}
		if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
			this.moveTab(1);
			return;
		}
		if (matchesKey(data, Key.shift(Key.tab)) || matchesKey(data, Key.left)) {
			this.moveTab(-1);
			return;
		}
		if (this.isReview()) this.handleReviewInput(data);
		else this.handleQuestionInput(data);
	}

	private addWrapped(lines: string[], prefix: string, text: string, width: number): void {
		const prefixWidth = visibleWidth(prefix);
		const available = Math.max(1, width - prefixWidth);
		const wrapped = wrapTextWithAnsi(text, available);
		const continuation = " ".repeat(prefixWidth);
		for (let index = 0; index < Math.max(1, wrapped.length); index++) {
			lines.push(`${index === 0 ? prefix : continuation}${wrapped[index] ?? ""}`);
		}
	}

	private buildQuestionBody(width: number): BodyLayout {
		const question = this.currentQuestion()!;
		if (this.inputMode) return this.buildCustomInputBody(width, question);
		const lines: string[] = [];
		const mode = question.multiSelect ? "Select one or more" : "Select one";
		this.addWrapped(
			lines,
			"  ",
			`${this.theme.fg("accent", this.theme.bold(question.header))}  ${this.theme.fg("dim", mode)}`,
			width,
		);
		this.addWrapped(lines, "  ", this.theme.fg("text", question.question), width);
		lines.push("");

		const answer = this.answerFor(question);
		const selected = selectedOptionIndexes(answer);
		let activeStart = 0;
		let activeEnd = 0;
		for (let index = 0; index < this.displayOptionCount(question); index++) {
			const isActive = index === this.optionIndex;
			const isOther = index === question.options.length;
			const option = question.options[index];
			const isSelected = isOther ? customAnswer(answer) !== undefined : selected.has(index);
			const marker = question.multiSelect ? (isSelected ? "☑" : "☐") : isSelected ? "●" : "○";
			const rail = isActive ? this.theme.fg("accent", "┃") : this.theme.fg("border", "│");
			const pointer = isActive ? this.theme.fg("accent", "›") : " ";
			const label = isOther ? "Write a custom answer" : option!.label;
			const badge = option?.recommended ? this.theme.fg("warning", "  ★ Recommended") : "";
			const labelStyle = isActive ? "accent" : isSelected ? "success" : "text";
			const start = lines.length;
			this.addWrapped(
				lines,
				` ${rail}${pointer} ${this.theme.fg(isSelected ? "success" : "muted", marker)} `,
				`${this.theme.fg(labelStyle, `${index + 1}. ${label}`)}${badge}`,
				width,
			);
			const description = isOther
				? customAnswer(answer)
					? `Current: ${answerSummary(answer)}`
					: "Enter text when the listed choices do not fit."
				: option!.description;
			if (description) this.addWrapped(lines, ` ${rail}    `, this.theme.fg("muted", description), width);
			lines.push(` ${rail}`);
			if (isActive) {
				activeStart = start;
				activeEnd = lines.length - 1;
			}
		}
		if (this.message) {
			this.addWrapped(lines, "  ", this.theme.fg("warning", `! ${this.message}`), width);
			activeEnd = lines.length - 1;
		}
		return { lines, activeStart, activeEnd };
	}

	private buildCustomInputBody(width: number, question: AskQuestion): BodyLayout {
		const lines: string[] = [];
		this.addWrapped(
			lines,
			"  ",
			`${this.theme.fg("accent", this.theme.bold(question.header))}  ${this.theme.fg("dim", "Custom answer")}`,
			width,
		);
		this.addWrapped(lines, "  ", this.theme.fg("text", question.question), width);
		lines.push("");
		this.addWrapped(lines, "  ", this.theme.fg("muted", "Your answer"), width);
		this.editor.focused = this.focused;
		const start = lines.length;
		for (const line of this.editor.render(Math.max(8, width - 4))) lines.push(`  ${line}`);
		if (this.message) this.addWrapped(lines, "  ", this.theme.fg("warning", `! ${this.message}`), width);
		return { lines, activeStart: start, activeEnd: lines.length - 1 };
	}

	private buildReviewBody(width: number): BodyLayout {
		const lines: string[] = [];
		this.addWrapped(lines, "  ", this.theme.fg("accent", this.theme.bold("Review your answers")), width);
		this.addWrapped(lines, "  ", this.theme.fg("muted", "Select a row to edit it, or submit when everything looks right."), width);
		lines.push("");
		let activeStart = 0;
		let activeEnd = 0;
		for (let index = 0; index < this.questions.length; index++) {
			const question = this.questions[index];
			const answer = this.answers.get(question.id);
			const complete = answerIsComplete(answer);
			const active = this.reviewIndex === index;
			const start = lines.length;
			const pointer = active ? this.theme.fg("accent", "›") : " ";
			const icon = complete ? this.theme.fg("success", "✓") : this.theme.fg("warning", "!");
			this.addWrapped(
				lines,
				`  ${pointer} ${icon} `,
				this.theme.fg(active ? "accent" : "text", `${index + 1}. ${question.header}`),
				width,
			);
			this.addWrapped(lines, "      ", this.theme.fg(complete ? "muted" : "warning", answerSummary(answer)), width);
			lines.push("");
			if (active) {
				activeStart = start;
				activeEnd = lines.length - 1;
			}
		}
		const submitActive = this.reviewIndex === this.questions.length;
		const submitStart = lines.length;
		const submit = this.allAnswered() ? "Submit answers" : "Complete unanswered questions";
		const submitColor = this.allAnswered() ? (submitActive ? "accent" : "success") : "dim";
		this.addWrapped(
			lines,
			submitActive ? `  ${this.theme.fg("accent", "›")} ` : "    ",
			this.theme.fg(submitColor, `[ ${submit} ]`),
			width,
		);
		if (submitActive) {
			activeStart = submitStart;
			activeEnd = lines.length - 1;
		}
		if (this.message) {
			this.addWrapped(lines, "  ", this.theme.fg("warning", `! ${this.message}`), width);
			activeEnd = lines.length - 1;
		}
		return { lines, activeStart, activeEnd };
	}

	private fit(text: string, width: number): string {
		const clipped = truncateToWidth(text, Math.max(1, width), "…", true);
		return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
	}

	private progressLine(): string {
		const current = this.isReview() ? "Review" : `${this.currentQuestionIndex + 1}/${this.questions.length}`;
		const steps = this.questions
			.map((question, index) => {
				const complete = answerIsComplete(this.answers.get(question.id));
				const active = !this.isReview() && index === this.currentQuestionIndex;
				const icon = complete ? "✓" : active ? "●" : "○";
				return `${icon} ${question.header}`;
			})
			.join("  ");
		return `${current} · ${this.answeredCount()}/${this.questions.length} answered  ${steps}`;
	}

	private footerLine(): string {
		if (this.inputMode) return "Enter submit · Esc back · Ctrl+C cancel";
		if (this.isReview()) return "↑↓ choose · Enter edit/submit · 1-3 edit · ←/Tab navigate · Esc×2 cancel";
		const question = this.currentQuestion()!;
		return question.multiSelect
			? "↑↓ choose · Space/1-6 toggle · Enter continue · Tab navigate · Esc×2 cancel"
			: "↑↓ choose · Enter/Space/1-6 select · Tab navigate · Esc×2 cancel";
	}

	render(width: number): string[] {
		const innerWidth = Math.max(1, width - 2);
		const terminalRows = Math.max(12, this.tui.terminal.rows || 24);
		const targetHeight = Math.max(11, Math.floor(terminalRows * 0.9));
		this.bodyHeight = Math.max(4, targetHeight - 7);
		const body = this.isReview() ? this.buildReviewBody(innerWidth) : this.buildQuestionBody(innerWidth);
		this.maxScroll = Math.max(0, body.lines.length - this.bodyHeight);
		if (body.activeStart < this.scrollOffset) this.scrollOffset = body.activeStart;
		if (body.activeEnd >= this.scrollOffset + this.bodyHeight) {
			this.scrollOffset = body.activeEnd - this.bodyHeight + 1;
		}
		this.scrollOffset = Math.max(0, Math.min(this.maxScroll, this.scrollOffset));
		const visible = body.lines.slice(this.scrollOffset, this.scrollOffset + this.bodyHeight);
		while (visible.length < this.bodyHeight) visible.push("");

		const border = (text: string) => this.theme.fg("border", text);
		const row = (text: string) => border("│") + this.fit(text, innerWidth) + border("│");
		const title = truncateToWidth(" Ask User Questions ", innerWidth, "…", true);
		const left = Math.max(0, Math.floor((innerWidth - visibleWidth(title)) / 2));
		const right = Math.max(0, innerWidth - visibleWidth(title) - left);
		const scroll = this.maxScroll > 0 ? `  ${this.scrollOffset + 1}-${Math.min(body.lines.length, this.scrollOffset + this.bodyHeight)}/${body.lines.length}` : "";

		return [
			border(`╭${"─".repeat(left)}`) + this.theme.fg("accent", this.theme.bold(title)) + border(`${"─".repeat(right)}╮`),
			row(`  ${this.theme.fg("muted", this.progressLine())}`),
			row(border("─".repeat(innerWidth))),
			...visible.map((line) => row(line)),
			row(border("─".repeat(innerWidth))),
			row(`  ${this.theme.fg("dim", `${this.footerLine()}${scroll}`)}`),
			border(`╰${"─".repeat(innerWidth)}╯`),
		];
	}
}

export async function openAskUserQuestions(
	ctx: ExtensionContext,
	questions: AskQuestion[],
	signal?: AbortSignal,
): Promise<AskUserQuestionsResult> {
	if (ctx.mode !== "tui") throw new Error("Ask User Questions requires interactive TUI mode.");
	return ctx.ui.custom<AskUserQuestionsResult>(
		(tui, theme, _keybindings, done) => new AskUserQuestionsComponent(tui, theme, questions, done, signal),
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "88%",
				minWidth: 42,
				maxHeight: "92%",
				margin: { top: 1, bottom: 1, left: 1, right: 1 },
			},
		},
	);
}
