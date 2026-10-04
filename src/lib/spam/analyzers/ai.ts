import type { SpamAiClassification, SpamAiClassifier, SpamSignal } from "../types";
import { AI_MODEL_ID, AI_MODEL_SELECTOR, AI_SPAM_MAX_BODY_CHARS, AI_SPAM_TIMEOUT_MS, SPAM_WEIGHTS } from "../weights";

type AiBinding = {
	run(model: string, input: Record<string, unknown>): Promise<unknown>;
};

type ChoiceAnswer = {
	type?: string;
	choice?: string;
	confidence?: number;
	probabilities?: Record<string, number>;
};

const QUESTIONS = {
	classification: {
		type: "choice",
		instructions: "Classify the email message described by the state.",
		criteria: {
			spam: "Unsolicited bulk marketing, phishing, scams, or fraud that the recipient did not ask for and that intends to deceive, steal, or sell aggressively.",
			suspicious: "Possibly unwanted or risky: promotions from unknown senders, vague solicitations, cold outreach, or messages pressing the recipient toward sensitive actions.",
			legitimate: "Ordinary personal or business correspondence the recipient plausibly wants, including receipts, account notifications, security alerts, and subscribed newsletters.",
		},
	},
} as const;

function normalizeAnswer(response: Record<string, unknown>): SpamAiClassification | null {
	const answers = response.answers as { classification?: ChoiceAnswer } | undefined;
	const answer = answers?.classification;
	if (!answer) return null;
	if (answer.type && answer.type !== "choice") return null;
	const choice = answer.choice;
	if (choice !== "spam" && choice !== "suspicious" && choice !== "legitimate") return null;
	const fromProbabilities = answer.probabilities?.[choice];
	const probability = typeof fromProbabilities === "number" && Number.isFinite(fromProbabilities)
		? fromProbabilities
		: typeof answer.confidence === "number" && Number.isFinite(answer.confidence)
			? answer.confidence
			: 0;
	return { choice, probability: Math.max(0, Math.min(1, probability)) };
}

export function createAiSpamClassifier(ai: unknown, timeoutMs: number = AI_SPAM_TIMEOUT_MS): SpamAiClassifier | null {
	const binding = ai as AiBinding | null;
	if (!binding) return null;
	return {
		async classify(input) {
			const state = {
				from: input.sender,
				subject: input.subject,
				body: input.body.slice(0, AI_SPAM_MAX_BODY_CHARS),
				urls: input.urlDomains.slice(0, 20),
			};
			const response = await Promise.race([
				binding.run(AI_MODEL_ID, { model: AI_MODEL_SELECTOR, state, questions: QUESTIONS }) as Promise<Record<string, unknown>>,
				new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
			]);
			return response ? normalizeAnswer(response) : null;
		},
	};
}

export async function classifyWithAi(
	classifier: SpamAiClassifier,
	input: Parameters<SpamAiClassifier["classify"]>[0],
): Promise<SpamAiClassification | null> {
	try {
		return await classifier.classify(input);
	} catch {
		return null;
	}
}

export function aiClassificationSignal(classification: SpamAiClassification, cap: number): SpamSignal | null {
	const weight = SPAM_WEIGHTS.ai;
	if (classification.choice === "legitimate" || classification.probability < weight.suspectConfidence) return null;
	const uncapped = classification.choice === "spam" && classification.probability >= weight.autoFileConfidence
		? weight.autoFile
		: weight.suspect;
	const score = Math.min(uncapped, cap);
	const reason = classification.choice === "spam"
		? "AI classifier identified this message as spam"
		: "AI classifier flagged this message as suspicious";
	return {
		id: "ai_spam_choice",
		score,
		reason,
		metadata: { choice: classification.choice, probability: Number(classification.probability.toFixed(3)) },
	};
}
