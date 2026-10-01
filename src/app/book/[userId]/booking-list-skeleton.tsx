export function BookingListSkeleton() {
	return <div role="status" aria-label="Loading meetings" className="space-y-3">
		<span className="sr-only">Loading meetings…</span>
		{[0, 1, 2].map((item) => <div key={item} className="rounded-2xl bg-white p-5 motion-safe:animate-pulse">
			<div className="h-5 w-2/3 rounded bg-neutral-200" />
			<div className="mt-4 h-3 w-5/6 rounded bg-neutral-100" />
			<div className="mt-3 h-3 w-1/3 rounded bg-neutral-100" />
		</div>)}
	</div>;
}
