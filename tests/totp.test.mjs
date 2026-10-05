import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-totp-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	entryPoints: [join(root, "src/lib/auth/totp.ts")],
	outfile: join(outDir, "totp.mjs"),
	bundle: true,
	format: "esm",
	target: "node22",
	logLevel: "silent",
});

const { base32Encode, base32Decode, hotp, totp, totpCounter, verifyTotp, totpDrift } = await import(
	pathToFileURL(join(outDir, "totp.mjs")).href
);

// The RFC 4226 appendix D test key.
const RFC_SECRET = base32Encode(new TextEncoder().encode("12345678901234567890"));

test("RFC 4226 HOTP test vectors (SHA-1, 6 digits)", async () => {
	const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
	for (let counter = 0; counter < expected.length; counter += 1) {
		assert.equal(await hotp(RFC_SECRET, counter), expected[counter], `counter ${counter}`);
	}
});

test("TOTP derives from the 30-second counter", async () => {
	// t = 0 falls in counter 0, t = 30_000 in counter 1.
	assert.equal(await totp(RFC_SECRET, 0), "755224");
	assert.equal(await totp(RFC_SECRET, 30_000), "287082");
	assert.equal(totpCounter(29_999), 0);
	assert.equal(totpCounter(30_000), 1);
});

test("verifyTotp accepts the current step and one on either side", async () => {
	const at = 59_000; // counter 1
	assert.equal(await verifyTotp(RFC_SECRET, "287082", at), true, "exact");
	assert.equal(await verifyTotp(RFC_SECRET, "755224", at), true, "one step behind");
	assert.equal(await verifyTotp(RFC_SECRET, "359152", at), true, "one step ahead");
});

test("verifyTotp rejects two steps away and garbage", async () => {
	const at = 59_000;
	assert.equal(await verifyTotp(RFC_SECRET, "969429", at), false, "two steps behind");
	assert.equal(await verifyTotp(RFC_SECRET, "338314", at), false, "two steps ahead");
	assert.equal(await verifyTotp(RFC_SECRET, "000000", at), false, "wrong code");
	assert.equal(await verifyTotp(RFC_SECRET, "12345", at), false, "too short");
	assert.equal(await verifyTotp(RFC_SECRET, "1234567", at), false, "too long");
	assert.equal(await verifyTotp(RFC_SECRET, "12 45a", at), false, "non-digits");
});

test("verifyTotp tolerates the spaces some apps and keyboards insert", async () => {
	assert.equal(await verifyTotp(RFC_SECRET, "287 082", 59_000), true);
});

test("totpDrift reports the step distance for codes just outside the window", async () => {
	const at = 150_000; // counter 5, code 254676
	assert.equal(await totpDrift(RFC_SECRET, "969429", at), -2, "two steps behind");
	assert.equal(await totpDrift(RFC_SECRET, "162583", at), 2, "two steps ahead");
	assert.equal(await totpDrift(RFC_SECRET, "359152", at), -3, "three steps behind");
	assert.equal(await totpDrift(RFC_SECRET, "399871", at), 3, "three steps ahead");
	assert.equal(await totpDrift(RFC_SECRET, "000000", at), null, "no match nearby");
	assert.equal(await totpDrift(RFC_SECRET, "254676", at), null, "inside the window: no drift");
});

test("base32 roundtrip and padding", async () => {
	const bytes = crypto.getRandomValues(new Uint8Array(20));
	assert.equal(base32Decode(base32Encode(bytes)).toString(), bytes.toString());
	// 20 bytes -> 160 bits -> exactly 32 base32 chars, no pad bits.
	assert.equal(base32Encode(bytes).length, 32);
});

test("generateTotpSecret shape", async () => {
	const { generateTotpSecret } = await import(pathToFileURL(join(outDir, "totp.mjs")).href);
	const secret = generateTotpSecret();
	assert.match(secret, /^[A-Z2-7]{32}$/);
	assert.notEqual(secret, generateTotpSecret(), "secrets must be freshly random");
});

test("buildOtpauthUrl carries the parameters every authenticator needs", async () => {
	const { buildOtpauthUrl } = await import(pathToFileURL(join(outDir, "totp.mjs")).href);
	const raw = buildOtpauthUrl({ issuer: "Mailflare", account: "a@b.example", secret: RFC_SECRET });
	assert.match(raw, /^otpauth:\/\/totp\/Mailflare:a%40b\.example\?/);
	const url = new URL(raw);
	assert.equal(url.searchParams.get("secret"), RFC_SECRET);
	assert.equal(url.searchParams.get("issuer"), "Mailflare");
	assert.equal(url.searchParams.get("algorithm"), "SHA1");
	assert.equal(url.searchParams.get("digits"), "6");
	assert.equal(url.searchParams.get("period"), "30");
});
