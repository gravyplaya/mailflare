import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { MfaSettings } from "@/components/settings/mfa-settings";

export default function SecuritySettingsPage() {
	return <div className="space-y-8 py-4">
		<section className="space-y-4">
			<div>
				<h1 className="text-xl font-semibold text-neutral-900">Security</h1>
				<p className="mt-1 text-sm text-neutral-500">Manage how you sign in to your account.</p>
			</div>
			<div className="space-y-4 rounded-3xl bg-white p-6">
				<div>
					<h2 className="text-lg font-semibold text-neutral-900">Change password</h2>
					<p className="mt-1 text-sm text-neutral-500">Use at least 8 characters for your new password.</p>
				</div>
				<ChangePasswordForm />
			</div>
			<div className="space-y-4 rounded-3xl bg-white p-6">
				<div>
					<h2 className="text-lg font-semibold text-neutral-900">Two-factor authentication</h2>
					<p className="mt-1 text-sm text-neutral-500">Require a code from an authenticator app when signing in.</p>
				</div>
				<MfaSettings />
			</div>
		</section>
	</div>;
}
