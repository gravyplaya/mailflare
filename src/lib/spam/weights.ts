export const SPAM_THRESHOLDS = { suspicious: 40, spam: 70 } as const;

export const SPAM_WEIGHTS = {
	authentication: { dmarcFail: 18, dmarcPass: -8, dkimFail: 8, dkimPass: -4, spfFail: 6, spfPass: -2 },
	relationships: { manuallySavedContact: -15, previouslySentTo: -25 },
	reputation: { establishedSpam: 25, establishedHam: -15 },
	content: { maximum: 30 },
	ai: { autoFileConfidence: 0.9, suspectConfidence: 0.7, autoFile: 75, suspect: 45, relationshipCap: 45 },
} as const;

export const AI_SPAM_TIMEOUT_MS = 4_000;
export const AI_SPAM_MAX_BODY_CHARS = 12_000;
export const JEV_MODEL_ID = "typesafe/jev";

export const MAX_CANDIDATE_TOKENS = 500;
export const MAX_BAYESIAN_TOKENS = 20;
export const TOKENIZER_VERSION = 1;
