import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "mailflare-spam-ai-test-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	entryPoints: [join(root, "src/lib/spam/analyzers/ai.ts")],
	outfile: join(outDir, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	tsconfig: join(root, "tsconfig.json"),
	logLevel: "silent",
});

const { createJevSpamClassifier, aiClassificationSignal, classifyWithJev } = await import(pathToFileURL(join(outDir, "entry.mjs")).href);

function fakeAi(response, calls = []) {
	return {
		async run(model, input) {
			calls.push({ model, input });
			if (typeof response === "function") return response(model, input);
			return response;
		},
	};
}

const hang = () => new Promise(() => {});

test("createJevSpamClassifier returns null without an AI binding", () => {
	assert.equal(createJevSpamClassifier(null), null);
});

test("classify sends state and fixed choice questions to the Jev model", async () => {
	const calls = [];
	const classifier = createJevSpamClassifier(fakeAi({
		answers: { classification: { type: "choice", choice: "spam", confidence: 0.9, probabilities: { spam: 0.97, suspicious: 0.03, legitimate: 0 } } },
	}, calls));
	const classification = await classifier.classify({ sender: "spam@example.com", subject: "Win big", body: "Click here now", urlDomains: ["trap.example"] });
	assert.deepEqual(classification, { choice: "spam", probability: 0.97 });
	assert.equal(calls.length, 1);
	assert.equal(calls[0].model, "typesafe/jev");
	const questions = calls[0].input.questions.classification;
	assert.equal(questions.type, "choice");
	assert.deepEqual(Object.keys(questions.criteria), ["spam", "suspicious", "legitimate"]);
	assert.deepEqual(calls[0].input.state, { from: "spam@example.com", subject: "Win big", body: "Click here now", urls: ["trap.example"] });
});

test("confidence falls back when probabilities are missing and rejects unknown choices", async () => {
	const classifier = createJevSpamClassifier(fakeAi({ answers: { classification: { type: "choice", choice: "suspicious", confidence: 0.82 } } }));
	assert.deepEqual(await classifier.classify({ sender: "a@b.c", subject: "", body: "", urlDomains: [] }), { choice: "suspicious", probability: 0.82 });
	const broken = createJevSpamClassifier(fakeAi({ answers: { classification: { type: "choice", choice: "make_money_fast", confidence: 1 } } }));
	assert.equal(await broken.classify({ sender: "a@b.c", subject: "", body: "", urlDomains: [] }), null);
});

test("classify fails open on timeout", async () => {
	const classifier = createJevSpamClassifier({ run: hang }, 30);
	assert.equal(await classifier.classify({ sender: "a@b.c", subject: "", body: "", urlDomains: [] }), null);
});

test("classifyWithJev swallows classifier errors", async () => {
	const failing = { classify: () => Promise.reject(new Error("boom")) };
	assert.equal(await classifyWithJev(failing, { sender: "", subject: "", body: "", urlDomains: [] }), null);
});

test("high-confidence spam auto-files, medium-confidence stays suspicious", () => {
	assert.equal(aiClassificationSignal({ choice: "spam", probability: 0.95 }, Number.POSITIVE_INFINITY)?.score, 75);
	assert.equal(aiClassificationSignal({ choice: "spam", probability: 0.75 }, Number.POSITIVE_INFINITY)?.score, 45);
	assert.equal(aiClassificationSignal({ choice: "suspicious", probability: 0.8 }, Number.POSITIVE_INFINITY)?.score, 45);
});

test("low-confidence and legitimate choices produce no signal", () => {
	assert.equal(aiClassificationSignal({ choice: "spam", probability: 0.5 }, Number.POSITIVE_INFINITY), null);
	assert.equal(aiClassificationSignal({ choice: "suspicious", probability: 0.4 }, Number.POSITIVE_INFINITY), null);
	assert.equal(aiClassificationSignal({ choice: "legitimate", probability: 0.99 }, Number.POSITIVE_INFINITY), null);
});

test("relationship senders are capped below the auto-file threshold", () => {
	const signal = aiClassificationSignal({ choice: "spam", probability: 1 }, 45);
	assert.equal(signal.score, 45);
	assert.equal(signal.id, "ai_spam_choice");
});
