export type ComposioImportRequest = {
	mailboxId?: string;
	connectedAccountId?: string;
	/** Gmail search query, e.g. "in:inbox" or "from:news@example.com". Empty means all mail. */
	query?: string;
	limit?: number;
	destination?: string;
};
