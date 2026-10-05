import type { RsvpRequest, RsvpStatus } from "./types";

export function parseRsvpRequest(input: RsvpRequest): RsvpStatus {
	if (input.status === "accepted" || input.status === "declined" || input.status === "tentative") {
		return input.status;
	}
	throw new Error("RSVP status must be accepted, declined, or tentative");
}
