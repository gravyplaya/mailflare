import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { getDb } from "@/db";
import { mfaRecoveryCodes, users } from "@/db/schema";
import { getBranding } from "@/lib/branding/service";
import { consumeRecoveryCode, countUnusedRecoveryCodes, issueRecoveryCodes } from "@/lib/auth/recovery-codes";
import { deleteUserSessions } from "@/lib/auth/session";
import { buildOtpauthUrl, generateTotpSecret, totpDrift, verifyTotp, TOTP_STEP_SECONDS } from "@/lib/auth/totp";
import type { MfaEnrollment, MfaStatus } from "@/lib/auth/mfa-types";

export async function getMfaStatus(env: CloudflareEnv, user: { id: string; totpEnabled: boolean; totpConfirmedAt: Date | null }): Promise<MfaStatus> {
	return {
		enabled: user.totpEnabled,
		confirmedAt: user.totpConfirmedAt?.toISOString() ?? null,
		recoveryCodesLeft: user.totpEnabled ? await countUnusedRecoveryCodes(env, user.id) : 0,
	};
}

/**
 * Start enrolment: a fresh secret is stored but not yet trusted. It only
 * becomes the account's second factor once `confirmMfaEnrollment` sees a
 * code generated from it, which proves the authenticator has it.
 *
 * A secret that is already pending but unconfirmed is reused rather than
 * replaced. Rotating on every attempt made retries impossible: the entry the
 * user already added to their authenticator stopped matching the moment they
 * re-entered their password, so each new attempt failed with a key that could
 * never verify. Reuse keeps the QR, the manual key and the stored secret in
 * sync until the code confirms all three.
 */
export async function beginMfaEnrollment(
	env: CloudflareEnv,
	user: { id: string; email: string; totpSecret: string | null; totpEnabled: boolean },
): Promise<MfaEnrollment> {
	const db = getDb(env);
	// The caller rejects accounts with the factor already on, so a stored
	// secret here can only be pending; anything else must not overwrite it.
	const secret = user.totpSecret ?? generateTotpSecret();
	if (secret !== user.totpSecret) {
		await db.update(users).set({ totpSecret: secret, totpEnabled: false, totpConfirmedAt: null }).where(eq(users.id, user.id));
	}
	const { appName } = await getBranding(env);
	const otpauthUrl = buildOtpauthUrl({ issuer: appName, account: user.email, secret });
	const qrSvg = await QRCode.toString(otpauthUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
	return { secret, otpauthUrl, qrSvg };
}

export async function confirmMfaEnrollment(
	env: CloudflareEnv,
	user: { id: string; totpSecret: string | null; totpEnabled: boolean },
	code: string,
	currentSessionToken?: string,
): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; error: string }> {
	if (!user.totpSecret) return { ok: false, error: "Start enrolment first" };
	if (user.totpEnabled) return { ok: false, error: "Two-factor authentication is already on" };
	if (!(await verifyTotp(user.totpSecret, code))) {
		const driftHint = await describeTotpDrift(user.totpSecret, code);
		if (driftHint) return { ok: false, error: driftHint };
		return { ok: false, error: "That code did not match. Make sure the key in your authenticator ends in the same characters as the one shown here, then try the current code." };
	}

	const db = getDb(env);
	await db.update(users).set({ totpEnabled: true, totpConfirmedAt: new Date() }).where(eq(users.id, user.id));
	const recoveryCodes = await issueRecoveryCodes(env, user.id);
	// Other sessions predate the second factor; make them sign in again with it.
	await deleteUserSessions(env, user.id, currentSessionToken);
	return { ok: true, recoveryCodes };
}

export async function disableMfa(env: CloudflareEnv, userId: string): Promise<void> {
	const db = getDb(env);
	await db.update(users).set({ totpSecret: null, totpEnabled: false, totpConfirmedAt: null }).where(eq(users.id, userId));
	await db.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
}

/**
 * A message for a code generated just outside the accepted window, or null
 * when the code matches nothing nearby. Tells a device-clock skew apart from
 * a wrong key, which look identical to the user otherwise.
 */
async function describeTotpDrift(secret: string, code: string): Promise<string | null> {
	const drift = await totpDrift(secret, code);
	if (drift === null) return null;
	const seconds = Math.abs(drift) * TOTP_STEP_SECONDS;
	let unit: string;
	if (seconds >= 60) {
		const minutes = Math.round(seconds / 60);
		unit = `${minutes} minute${minutes === 1 ? "" : "s"}`;
	} else {
		unit = `${seconds} seconds`;
	}
	return `That code looks right but is from ${drift < 0 ? "the past" : "the future"} by about ${unit}. Check the date, time and time zone on your device and try again.`;
}

/** A login's second step: a TOTP code, or one of the recovery codes as a fallback. */
export async function verifySecondFactor(
	env: CloudflareEnv,
	user: { id: string; totpSecret: string | null; totpEnabled: boolean },
	code: string,
): Promise<"totp" | "recovery" | null> {
	if (!user.totpEnabled || !user.totpSecret) return null;
	if (await verifyTotp(user.totpSecret, code)) return "totp";
	if (await consumeRecoveryCode(env, user.id, code)) return "recovery";
	return null;
}

/** Why a second factor failed, so sign-in can say something more useful than "no". */
export async function secondFactorFailureReason(user: { totpSecret: string | null; totpEnabled: boolean }, code: string): Promise<string | null> {
	if (!user.totpEnabled || !user.totpSecret) return null;
	return describeTotpDrift(user.totpSecret, code);
}
