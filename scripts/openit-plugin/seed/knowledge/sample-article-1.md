# Sample — Requesting VPN / SSO access

> Sample KB article — safe to delete. Replace with your own runbooks as you capture answers.

When a teammate needs VPN or SSO access to an internal tool:

1. **Confirm what they're actually trying to reach.** "VPN access" usually means one specific app behind the network — get the URL or service name so you grant the narrowest access that unblocks them.
2. **Check whether SSO already covers it.** Most internal tools are behind the identity provider (Okta, Google, Entra). If the app is in the SSO catalog, assign it there instead of provisioning a separate VPN profile.
3. **Provision via the access portal, not by hand.** Identity provider → Applications → assign the user (or their group). Group-based assignment is preferred so the access follows their role and gets revoked automatically at offboarding.
4. **Confirm in the ticket.** Reply with "Assigned you to <app> via SSO — sign out and back in, then it'll appear on your dashboard. Ping me if MFA prompts loop."

## When to escalate

If the request needs **full network VPN** rather than a single SSO app, escalate to whoever owns the network policy. Don't hand out broad VPN profiles by default — most "I need VPN access" requests are satisfied by assigning the one SSO app the person was trying to reach.
