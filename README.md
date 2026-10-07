<img src="/public/icon-96.png" alt="Mailflare" width="72" />

# Mailflare

Mailflare is a self-hosted email inbox for custom domains, built on Cloudflare.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/hieunc229/mailflare)

## Screenshots

| ![Inbox](/screenshots/1.png)<br>Inbox | ![Manage domains](/screenshots/2.png)<br>Manage domains | ![Manage inboxes](/screenshots/3.png)<br>Manage inboxes |
| --- | --- | --- |

### Featured sponsors

<a target="_blank" href="https://sequenzy.com/?ref=hieunc229/mailflare">
  <img height="80" src="/sponsors/sequenzy.png" alt="Sequenzy">
</a>  <a target="_blank" href="https://drivemug.com/?ref=hieunc229/mailflare">
  <img height="80" src="https://mailflare.co/sponsors/drivemug.png" alt="Drivemug">
</a>

Want to support the mailflare? <a target="_blank" href="https://store.paymug.co/buy/mailflare-sponsor">Start sponsoring</a>

## What you can do

- **Domain setup**: Connect domains and set up Cloudflare Email Routing from the dashboard.
- **Mailboxes**: Create personal and shared mailboxes with delegated access.
- **Email**: Send and receive email with attachments, rich formatting, signatures, and automatic replies.
- **Inbox organization**: Organize mail with search, custom folders, stars, snoozing, archive, spam, and trash.
- **Focus and triage**: Gatekeeper holds mail from new senders until you accept or block them, mute quiet threads, mark priority senders to pin their mail, mark emails as done, and set follow-up reminders when sending.
- **Routing rules**: Create routing rules to store, forward, reject, or categorize incoming messages.
- **Notifications**: Get real-time inbox updates and new-message notifications.
- **Mail and contacts**: Import and export mail, manage contacts, and block unwanted senders.
- **Administration**: Manage accounts, permissions, API keys, webhooks, audit logs, and database backups.
- **Email AI Assistant**: Use an AI assistant to search mail, work with threads, and prepare drafts for a selected mailbox.
- **MCP access**: Connect external AI clients through MCP with mailbox or admin permissions chosen for each key.

## How it works

Mailflare runs in your Cloudflare account. Email Routing delivers incoming messages to the app, while Cloudflare's email service handles outgoing messages. Your mail data stays in your own D1 database and attachments are stored in your own R2 bucket.

## How much does it cost?

You can setup Mailflare and receive email for free

A [Paid Worker](https://developers.cloudflare.com/workers/platform/pricing/) plan ($5/month) is required to send email (and it's recommend to have a smooth experience)

## Deploy

Getting started takes three steps:

1. **Deploy the app.** Click **Deploy to Cloudflare** and keep the app name as `mailflare`. The app will not work correctly under another Worker name.
2. **Complete setup.** Open the deployed app and follow `/setup` to check the installation and create your admin account.
3. **Connect your domain.** Add a domain managed by the same Cloudflare account. Mailflare configures its email routing and helps you create the first mailbox.

⚠️ IMPORTANT: **`CF_TOKEN` is required during deployment**. Create a scoped [Cloudflare API token with the following permissions](https://github.com/hieunc229/mailflare/issues/24#issuecomment-5523686105) for the domains you want to connect.
- All accounts - Email Sending:Edit, DNS Settings:Edit, Email Routing Addresses:Edit
- All zones - DNS Settings:Edit, Email Routing Rules:Edit, Zone Settings:Edit, DNS:Edit

### Deploy with an AI coding agent

You can paste the prompt below into an agent that has terminal access. Give it the Cloudflare account ID and **two separate scoped API tokens** through the agent's secret input, not in a public chat, repository, or committed file:

- **Deployment token** (used locally by Wrangler as `CLOUDFLARE_API_TOKEN`): scope it to the target account with **Workers Scripts Edit** (or **Workers Admin** if Cloudflare's newer granular roles are shown, since this is a new Worker), **D1 Edit**, **Workers R2 Storage Edit**, **Queues Edit**, and **Account Settings Read**. Add **Workers Routes Edit** for the target zone only if you want the agent to attach a custom domain or route. See Cloudflare's [token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) and [Workers roles](https://developers.cloudflare.com/workers/authorization/workers/).
- **Runtime token** (stored as the Worker's `CF_TOKEN` secret): use the domain permissions listed above. Add **Email Sending Edit** if you want to send mail. This token is separate from the deployment token and must cover the zones you will connect in Mailflare.

```text
Install Mailflare from https://github.com/hieunc229/mailflare in my Cloudflare account.
Ask me for my Cloudflare account ID, a scoped deployment API token, and a separate
runtime CF_TOKEN through a secret input. Never print, commit, or place either token
in a command argument or a tracked file. Use the deployment token only for Wrangler
authentication (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID).

Read README.md, docs/deployment.md, and wrangler.jsonc first. Keep the Worker name
exactly mailflare. In the selected account, create or reuse the D1 database
mailflare, R2 bucket mailflare-raw, and Queues mailflare-inbound,
mailflare-outbound, and mailflare-agent. Set the D1 database_id in the local
Wrangler config without committing that account-specific ID. Install dependencies,
run npm run deploy, and set the runtime CF_TOKEN as a Worker secret. Do not run
remote D1 migrations manually; the /setup flow initializes the database.

Give me the deployed URL and any remaining Cloudflare account actions. I will
open /setup, create the first admin account, and connect my domain there.
```

See the [deployment guide](docs/deployment.md) for required permissions, manual deployment, backups, and updates.

### Self-host with Docker instead

Mailflare also runs as one container on any server, with SQLite and local files in place of D1 and R2, a built-in SMTP listener for inbound mail (or a small Cloudflare relay Worker if you want to keep MX on Cloudflare), and any SMTP relay or Cloudflare Email Sending for outbound.

```bash
cp .env.docker.example .env.docker
docker compose up -d --build
```

See [docs/self-hosting.md](docs/self-hosting.md).

## Local development

```bash
cp .dev.vars.example .dev.vars
npm install
npm run db:migrate:local
npm run dev
```

Add your Cloudflare credentials to `.dev.vars`, then open [http://localhost:3000](http://localhost:3000). For sample local data, run `npm run db:seed` while the development server is running.

The Cloudflare app uses vinext and the Cloudflare Vite plugin, including local D1, R2, Queues, and Durable Objects. Remote bindings are disabled by default. To use Workers AI locally, authenticate with Wrangler, select your account with `CLOUDFLARE_ACCOUNT_ID`, and run `CLOUDFLARE_REMOTE_BINDINGS=true npm run dev`.

`npm run build` builds the complete Worker; `npm run start` previews that build locally. `npm run deploy` builds and deploys it. The separate Node/Docker runtime still uses Next.js and the existing `build:node`, `start:node`, and `dev:node` commands.

## Documentation

- [Deployment and configuration](docs/deployment.md)
- [API and integrations](docs/api.md)
- [Email assistant and MCP](docs/email-assistant-and-mcp.md)
- [Troubleshooting](docs/troubleshooting.md)

## License

See [LICENSE](LICENSE).
