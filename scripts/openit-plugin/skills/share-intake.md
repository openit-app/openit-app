---
name: share-intake
description: Share the intake form with employees via a Cloudflare tunnel. Auto-installs cloudflared if missing, starts the tunnel, and gives the admin the public URL.
---

## When to use

Slash-invoked from the OpenIT chat pane, or auto-injected when the
admin clicks the **share** icon on the intake form pill in the status
bar.

## The flow

One job: get a public URL for the intake form so employees can reach
it. The tunnel runs as long as OpenIT is open.

Tone: terse, conversational. Like a coworker. No emojis.

**Do not ask the user to install anything manually.** If cloudflared
is missing, install it yourself. You have Bash — use it.

### Step 0 — check current state

First check if a tunnel is already running:

```bash
cat .openit/tunnel.json 2>/dev/null
```

If the file exists and has a `url` field → already sharing. Reply:

> Already sharing at **<url>**. Send that link to your team —
> anyone who opens it gets the intake form. The link stays live
> as long as OpenIT is running. To stop sharing, I can tear it down.

Then stop. If the admin asks to stop, run:

```bash
curl -s -X POST "$(cat .openit/intake.json | node -e "process.stdin.on('data',d=>{try{console.log(JSON.parse(d).url)}catch{console.log('http://127.0.0.1:54321')}})")/share/stop"
```

And confirm: "Stopped. The link is dead now."

### Step 1 — ensure cloudflared is installed

```bash
which cloudflared
```

If found, skip to Step 2.

If **not found**, install it automatically based on the OS. Detect
the platform and run the appropriate command — do NOT ask the user
to do it:

**macOS:**
```bash
brew install cloudflare/cloudflare/cloudflared
```

**Linux (Debian/Ubuntu):**
```bash
curl -L https://pkg.cloudflare.com/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb && sudo dpkg -i /tmp/cloudflared.deb
```
If `dpkg` isn't available (non-Debian), fall back to the binary:
```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared
```

**Windows (PowerShell):**
```powershell
winget install Cloudflare.cloudflared
```
If `winget` isn't available:
```powershell
choco install cloudflared
```

After installing, verify with `which cloudflared` (or `where cloudflared`
on Windows). If the install fails, show the error and suggest the user
check their network or package manager.

Tell the user briefly what you're doing:

> cloudflared isn't installed — installing it now…

Then just do it. No "run this and ping me."

### Step 2 — start the tunnel

Read the intake server URL:

```bash
cat .openit/intake.json
```

Then start the tunnel via the intake server's share endpoint:

```bash
curl -s -X POST "$(cat .openit/intake.json | node -e "process.stdin.on('data',d=>{try{console.log(JSON.parse(d).url)}catch{console.log('http://127.0.0.1:54321')}})")/share/start"
```

This returns `{"url":"https://<random>.trycloudflare.com"}`.

If it succeeds, reply:

> Live. Your intake form is at:
>
> **<url>**
>
> Send that to your team. Anyone who opens it sees the intake form
> and can submit questions. Their tickets land in your inbox here.
>
> The link stays up as long as OpenIT is running. Closing the app
> or running `/share-intake` again lets you stop it.

If it fails, show the error and suggest fixes.
