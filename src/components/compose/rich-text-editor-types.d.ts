export type RichTextEditorProps = {
	id: string;
	/** Editable HTML. */
	value: string;
	onChange: (html: string) => void;
	/** Quoted or forwarded HTML shown folded under the editable area. */
	quotedHtml?: string | null;
	disabled?: boolean;
	placeholder?: string;
	className?: string;
	toolbarStart?: React.ReactNode;
	toolbarEnd?: React.ReactNode;
	footerContent?: React.ReactNode;
	/**
	 * Embed an image picked by paste, drop, or the toolbar. Returns one entry
	 * per file with the src to display in the body, or null when that file was
	 * rejected.
	 */
	onEmbedImages?: (files: File[]) => Promise<Array<{ src: string; alt?: string } | null>>;
};

export type ToolbarCommand = {
	command: string;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
	value?: string;
};
