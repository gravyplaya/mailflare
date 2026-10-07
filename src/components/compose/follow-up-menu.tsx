"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { AlarmClock, Check, ChevronDown, X } from "lucide-react";
import { formatDateTimeLocal, formatScheduledSend, parseDateTimeLocal } from "./schedule-send-utils";
import type { FollowUpMenuProps } from "./follow-up-types";
import { getUserTimeZone } from "@/lib/time/utils";

function getFollowUpOptions(now = new Date()): Array<{ label: string; value: Date | null }> {
	const day = 24 * 60 * 60 * 1000;
	return [
		{ label: "In 2 days", value: new Date(now.getTime() + 2 * day) },
		{ label: "In 3 days", value: new Date(now.getTime() + 3 * day) },
		{ label: "In 1 week", value: new Date(now.getTime() + 7 * day) },
	];
}

export function FollowUpMenu({ disabled, value, onChange }: FollowUpMenuProps) {
	const options = getFollowUpOptions();
	const minimum = new Date(Date.now() + 5 * 60 * 1000);

	return (
		<DropdownMenu.Root>
			<DropdownMenu.Trigger
				type="button"
				disabled={disabled}
				aria-label="Follow-up reminder options"
				className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${
					value
						? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
						: "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
				}`}
			>
				<AlarmClock className="h-4 w-4" />
				<span className="hidden max-w-40 truncate text-xs sm:inline">
					{value ? `Follow-up ${formatScheduledSend(value)}` : "Follow-up"}
				</span>
				<ChevronDown className="h-3 w-3" />
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content
					align="start"
					sideOffset={6}
					className="z-50 min-w-64 rounded-lg border border-neutral-200 bg-white p-1 text-sm shadow-lg"
				>
					{value && (
						<>
							<DropdownMenu.Item
								onSelect={() => onChange(null)}
								className="flex cursor-pointer items-center rounded-md px-3 py-2 outline-none hover:bg-neutral-100 focus:bg-neutral-100"
							>
								<X className="mr-2 h-4 w-4" />
								Clear follow-up
							</DropdownMenu.Item>
							<DropdownMenu.Separator className="my-1 h-px bg-neutral-100" />
						</>
					)}
					<DropdownMenu.Label className="px-3 pb-1 pt-2 text-xs font-medium text-neutral-500">
						Remind me if no reply by
					</DropdownMenu.Label>
					{options.map((option) => (
						<DropdownMenu.Item
							key={option.label}
							onSelect={() => onChange(option.value)}
							className="flex cursor-pointer items-center rounded-md px-3 py-2 outline-none hover:bg-neutral-100 focus:bg-neutral-100"
						>
							<Check className={`mr-2 h-4 w-4 ${value && option.value && value.getTime() === option.value.getTime() ? "" : "opacity-0"}`} />
							{option.label}
							<span className="ml-2 text-xs text-neutral-400">
								{option.value && formatScheduledSend(option.value)}
							</span>
						</DropdownMenu.Item>
					))}
					<DropdownMenu.Separator className="my-1 h-px bg-neutral-100" />
					<DropdownMenu.Label className="px-3 pb-1 pt-2 text-xs font-medium text-neutral-500">
						Pick date &amp; time ({getUserTimeZone()})
					</DropdownMenu.Label>
					<input
						type="datetime-local"
						min={formatDateTimeLocal(minimum)}
						value={value ? formatDateTimeLocal(value) : ""}
						onChange={(event) => onChange(parseDateTimeLocal(event.target.value))}
						onKeyDown={(event) => event.stopPropagation()}
						className="mx-2 mb-2 h-9 rounded-md border border-neutral-200 px-2 text-sm outline-none focus:border-blue-400"
					/>
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
}
