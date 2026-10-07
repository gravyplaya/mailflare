import type { RealtimeNotificationEvent } from "@/hooks/message-realtime-types";

export interface NewMessagePopupProps {
	notification: RealtimeNotificationEvent;
	onDismiss: () => void;
}
