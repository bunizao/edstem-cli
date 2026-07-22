# Terms of Service

These terms apply to the `edstem-mcp` service running at [https://edstem.tuuhub.com](https://edstem.tuuhub.com).

- project: [`bunizao/edstem-cli`](https://github.com/bunizao/edstem-cli)
- contact: [contact@tuuhub.com](mailto:contact@tuuhub.com)

By connecting an MCP client, pasting an Ed API token, reconnecting Ed access, or using this service, you agree to these terms.

## 1. What This Service Is

`edstem-mcp` is a personal open-source project. It is a remote MCP server that lets compatible MCP clients access Ed Discussion on your behalf using your own Ed API token.

This service is not affiliated with, endorsed by, or operated by Ed Discussion, your institution, or your MCP client vendor.

## 2. What Data This Service Handles

This service may handle:

- your Ed API token;
- your Ed account identity returned by Ed during token verification, such as Ed user ID, email, and display name;
- a local account record used to associate your Ed connection with this service;
- service-issued OAuth authorization codes, access tokens, and refresh tokens;
- browser session and CSRF cookies used for the authorization, reconnect, and settings flows;
- operational and security data such as request IDs, client IP addresses, event logs, and error logs;
- database backups that may contain the same categories of data as the live database.

This service is intended to collect only the data needed to run the service, secure it, debug failures, enforce scopes, and delete or recover data when needed.

## 3. How Your Ed Token Is Stored and Used

Your Ed token is handled as follows:

1. You paste the token into the authorization, reconnect, or settings form.
2. The service verifies the token against Ed's `/api/user` endpoint before storing it.
3. If verification fails, the token should not be stored.
4. If verification succeeds, the token is encrypted at rest using AES-256-GCM before being written to the local database.
5. The database stores the encrypted token material together with limited metadata needed to run the connection, including Ed user ID, Ed user name, verification time, invalidation status, and record timestamps.
6. The plaintext token is intended to exist only briefly in process memory while being verified, used for an Ed API request, or re-encrypted during key rotation.

This service is designed not to log plaintext Ed tokens or include them in user-facing error messages.

## 4. Relationship Between Users and Tokens

The service keeps several different credentials, and they are not the same thing:

- your Ed token is your credential for Ed Discussion;
- this service issues its own OAuth access and refresh tokens so your MCP client can call this service;
- your MCP client should receive service OAuth tokens, not your raw Ed token;
- one local account on this service is intended to map to one verified Ed account at a time;
- reconnecting or rotating a token is intended for the same Ed account, not a different one.

Current implementation detail: service OAuth access tokens and refresh tokens are stored in the local database by token value, together with user, client, scope, and expiry metadata, so the service can validate, refresh, revoke, prune, and delete them.

## 5. Retention, Deletion, and Backups

Data may remain stored for as long as reasonably needed to operate the service, maintain security, support recovery, and handle legitimate abuse or incident investigation.

In practice:

- OAuth authorization codes may be deleted after use or expiry;
- service access tokens and refresh tokens may remain until expiry, revocation, cleanup, or account deletion;
- an encrypted Ed credential may remain until you rotate it, delete the local account, or the service removes it;
- if Ed later rejects your token, the service may mark it invalid and require reconnect instead of silently deleting it;
- backups may preserve deleted data until those backups age out or are removed.

If you use the account deletion flow provided by the service, the live database is intended to remove the local account, encrypted Ed credential, browser session, and associated service-issued OAuth records. Existing backups may survive longer.

## 6. Your Responsibilities

You are responsible for:

- using only Ed accounts you own or are authorized to use;
- keeping your Ed token, browser session, and MCP client credentials secure;
- granting write scope only if you actually want write operations performed on your behalf;
- reviewing the behavior of any MCP client you connect to this service;
- complying with Ed Discussion terms, institutional rules, and applicable law.

You must not use this service to impersonate others, abuse Ed Discussion, bypass security controls, or perform unlawful or fraudulent activity.

## 7. Third-Party Services

Using this service may involve third-party systems, including:

- Ed Discussion;
- your MCP client;
- hosting, storage, proxy, logging, or backup providers used to run this service.

Those systems have their own terms, uptime, retention, and privacy practices. This service cannot control third-party outages, account restrictions, policy changes, or data handling outside its own runtime and storage.

## 8. Security and Limits

This service is intended to use reasonable technical controls, including encrypted Ed token storage, scope checks, signed sessions, CSRF protection on browser forms, and rate limiting on sensitive routes.

That does not make it magic. No service is perfectly secure. If the database, master key, browser session, MCP client, or hosting environment is compromised, your data or tokens may also be at risk.

If you suspect compromise, regenerate your Ed token, disconnect or delete your local account, and contact [contact@tuuhub.com](mailto:contact@tuuhub.com).

## 9. Disclaimer

This service is provided on an "as is" and "as available" basis.

No guarantee is made that:

- the service will always be available;
- Ed Discussion will remain reachable or API-compatible;
- every MCP client will work correctly;
- every write action will succeed or be reversible;
- the service will prevent every data loss event, security incident, or misuse by a client you authorized.

This is a bridge service, not a warranty.

## 10. Limitation of Liability

To the maximum extent permitted by applicable law, the operator of this project is not liable for indirect, incidental, consequential, special, exemplary, or punitive damages, or for loss of data, access, educational opportunity, business, or client-side misuse arising from or related to this service.

Nothing in these terms excludes liability that cannot legally be excluded.

## 11. Changes to These Terms

These terms may be updated from time to time to reflect changes to the service, security posture, or operating model. The current version in the project repository is the governing version unless a newer version is published on the service site.

## 12. Contact

Questions, privacy requests, deletion requests, and security reports can be sent to [contact@tuuhub.com](mailto:contact@tuuhub.com).
