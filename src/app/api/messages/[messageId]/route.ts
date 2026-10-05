import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { getMessageWithBodyForUser } from "@/lib/email/inbound";
import { loadMessageInvite } from "@/lib/calendar/invites";
import { getInviteStatus } from "@/lib/calendar/invites";

type MessageRouteParams = {
	params: Promise<{ messageId: string }>;
};

export async function GET(request: Request, { params }: MessageRouteParams) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { messageId } = await params;
	const data = await getMessageWithBodyForUser(env, user, messageId);
	if (!data) {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}

	let invite: {
		uid: string;
		summary: string;
		description: string;
		location: string;
		startsAt: string;
		endsAt: string | null;
		allDay: boolean;
		organizerEmail: string | null;
		responded: boolean;
	} | null = null;
	try {
		const parsed = await loadMessageInvite(env, messageId);
		if (parsed && parsed.method !== "REPLY") {
			const status = await getInviteStatus(env, parsed.uid);
			invite = {
				uid: parsed.uid,
				summary: parsed.summary,
				description: parsed.description,
				location: parsed.location,
				startsAt: parsed.start.toISOString(),
				endsAt: parsed.end ? parsed.end.toISOString() : null,
				allDay: parsed.allDay,
				organizerEmail: parsed.organizerEmail,
				responded: status === "accepted",
			};
		}
	} catch {
		// Invite parsing is best-effort; the message itself remains viewable.
	}

	return NextResponse.json({ ...data, invite });
}
