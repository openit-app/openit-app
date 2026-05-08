---
name: share-intake
description: Share the intake form with employees via a Cloudflare tunnel. Checks for cloudflared, starts the tunnel, and gives the admin the public URL.
---

## When to use

Slash-invoked from the OpenIT chat pane, or auto-injected when the
admin clicks the **share** icon on the intake form pill in the status
bar.

## The flow

One job: get a public URL for the intake form so employees can reach
it. The tunnel runs as long as OpenIT is open.

Tone: terse, conversational. Like a coworker. No emojis.

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
curl -s -X POST http://127.0.0.1:$(cat .openit/intake.json 2>/dev/null | node -e "process.stdin.on('data',d=>{try{const u=new URL(JSON.parse(d).url);console.log(u.port)}catch{console.log('54321')}})")/share/stop
```

And confirm: "Stopped. The link is dead now."

### Step 1 — check cloudflared

```bash
which cloudflared
```

If not found, tell the admin to install it:

> You need `cloudflared` (Cloudflare's free tunnel tool). Install it:
>
> ```
> brew install cloudflared
> ```
>
> Run that and ping me when it's done.

Wait for confirmation, then re-check with `which cloudflared`.

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

If it fails (e.g. cloudflared not found, network error), show the
error and suggest fixes.
