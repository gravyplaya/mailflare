export interface NewMessageEvent {
	from: string;
	fromName: string | null;
	mailboxId: string;
	messageId: string;
	subject: string | null;
	type: "new_message";
}

export interface FollowUpDueEvent {
	type: "follow_up_due";
	messageId: string;
	mailboxId: string;
	subject: string | null;
}

export type RealtimeNotificationEvent = NewMessageEvent | FollowUpDueEvent;

export interface MessageRealtimeState {
	dismissNotification: () => void;
	notification: RealtimeNotificationEvent | null;
}

export type RealtimeChannelMessage =
	| { type: "status"; connected: boolean }
	| { type: "status_request" }
	| { type: "notification"; payload: string }
	| { type: "refresh" };
