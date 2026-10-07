"use client";

import { doneFolderConfig } from "@/components/messages/message-folder-configs";
import { MessageFolderPage } from "@/components/messages/message-folder-page";

export default function DonePage() {
	return <MessageFolderPage config={doneFolderConfig} />;
}
