# Deploy the ordy workspace

The chat entry serves the ordy Next.js workspace. Synapse remains the Matrix backend. Element is an optional compatibility client, not the workspace's primary interface.

This repository defines the gateway and its default ports. The external proxy for `ordy-chat.floritzmaier.xyz` is managed outside this repository. Merging a PR does not switch that proxy or deploy the app.

## Configure the two app origins

Keep `PUBLIC_URL` set to the existing outside-portal base URL used in request links. Set the workspace origin separately:

```dotenv
WORKSPACE_URL=https://ordy-chat.floritzmaier.xyz
```

The session endpoint accepts browser mutations only from the exact origins of `PUBLIC_URL` and `WORKSPACE_URL`. Include the scheme and any non-default port. Restart Next.js after changing either value. Do not add a wildcard origin to work around a proxy error.

The existing `ORDY_SECRET` must be a private key of at least 32 characters. `scripts/init-env.ts` creates one on a new installation and preserves a valid existing key. Keep `.env` out of git.

The workspace uses existing Matrix accounts on `MATRIX_SERVER_NAME` through `MATRIX_HOMESERVER_URL`. Keep the current Synapse connection settings. No registration or identity-provider change is needed for this UI migration.

## Choose the gateway upstream

By default, the `workspace` Compose service publishes port 8081 and forwards every path to the host's Next.js process on port 3010:

```dotenv
ORDY_WEB_UPSTREAM=host.docker.internal:3010
```

The host mapping also works on Linux through Docker's `host-gateway`. If Next.js runs in the same Docker network, set `ORDY_WEB_UPSTREAM` to that service's name and port. For example, a web service named `ordy-web` listening on 3010 uses `ordy-web:3010`. The value is a host and port, without a URL scheme or path. This repository runs Next.js on the host by default.

The gateway preserves the full request path, query, original Host including its port, and forwarded host. It supports WebSocket upgrades for local Next.js development and disables proxy buffering for streaming. Its 128 KiB body limit permits the application's 64 KiB upload plus form fields; Next.js still enforces its own upload and JSON limits. It does not cache authenticated responses.

The gateway disables access logs and limits nginx error logs to critical diagnostics. Request paths and queries can contain bearer links or clinical tRPC inputs. Configure the external TLS proxy and any monitoring agent to omit request URIs, query strings, bodies, cookies, and authorization headers too. Use the application's sanitized errors for operational troubleshooting.

At the external TLS proxy, set `X-Forwarded-Proto` from the actual connection. The gateway preserves `http` or `https` and otherwise uses its own scheme. Keep the gateway behind the trusted TLS proxy in production. Cookie security follows configured HTTPS and production settings, not the gateway's internal HTTP hop.

## Migrate an existing Element entry

Apply these steps in the deployment environment after the new app has been reviewed and merged. Do not run them against another developer's shared services.

1. Install the new dependencies and build the app:

   ```bash
   pnpm install --frozen-lockfile
   pnpm build
   ```

2. Set `WORKSPACE_URL` and the upstream as described above, then restart the existing ordy web and bot processes with the deployment's normal process manager. Do not start a second bot. For a foreground installation, stop its old `pnpm start` process before starting the new one.
3. Stop the old Element service before starting the gateway:

   ```bash
   docker compose --profile legacy-element stop element
   docker compose up -d workspace
   ```

   The old Element container may still hold port 8081 even though its service now has an optional profile. `docker compose up` does not stop an existing container merely because its service moved into an optional profile. No Postgres, HAPI, Matrix room, or Matrix user needs to be reset.

4. Route the workspace hostname to the gateway:

   | Public hostname | Upstream |
   |---|---|
   | `ordy-chat.floritzmaier.xyz` | The `workspace` service on port 80, or its published host port 8081 |
   | `ordy-matrix.floritzmaier.xyz` | The existing Synapse client-server endpoint, normally host port 8008 |
   | The origin already configured in `PUBLIC_URL` | The existing Next.js app, normally host port 3010 |

   A TLS proxy on the same host can forward `ordy-chat.floritzmaier.xyz` to `http://127.0.0.1:8081`. It can also point directly at Next.js on 3010 if the gateway is unnecessary in that installation. Do not leave the chat hostname pointing at the Element image or its optional port 8082.

5. Open `https://ordy-chat.floritzmaier.xyz/`. It must show ordy's sign-in screen and design. Sign in with the existing network account, open **Messages**, and choose the existing room. The old `/#/room/#outside-documents:klinikum.example` link opens that room in Messages after sign-in.
6. Confirm a clinical view reads its real data and that the outside-person request link still uses the origin in `PUBLIC_URL`. Sign out and confirm that the previous clinical view and message history are no longer visible.

## Keep Element as an optional client

To use the old client for compatibility checks:

```bash
docker compose --profile legacy-element up -d element
```

Open http://localhost:8082. It uses the same Synapse accounts and rooms. The legacy ordy widget remains at `/widget`; it still asks Element for a Matrix OpenID token. The primary workspace needs neither Element nor an iframe.

## Session and chat limits

The workspace keeps its Matrix token in an authenticated encrypted, HttpOnly cookie for at most eight hours. It never sends that token to JavaScript or browser storage. Logout clears the local session and requests revocation of this workspace device's token while the cookie is valid. Remote revocation is best effort. If the cookie has already expired or Synapse is unavailable, the Matrix device can remain until the account owner removes it. An expired cookie cannot open the workspace. Logout does not affect an existing Element or bot device.

Workspace tRPC requests opt into this identity with `x-ordy-workspace: 1`. The outside portal keeps its separate ID Austria cookie and authentication path. Both identities can exist in the same browser profile without turning a portal request into a clinic request. Existing requester ownership rules remain in force.

Messages lists only rooms the signed-in member has joined. It reads text and notices, supports older history, and sends plain text as that member. A retry keeps the same Matrix transaction ID. Encrypted rooms are shown as unsupported and cannot receive a plaintext message from this client. Media, room administration, invitations, and account creation remain outside this client.

The open conversation polls every five seconds while the tab is active. Refresh fetches all history pages already loaded in that conversation. Loading a long history therefore increases the Matrix requests per refresh.

## Verify the gateway without changing shared ports

Use an isolated gateway on 18081 and a Next.js process whose `WORKSPACE_URL` is exactly `http://localhost:18081`. Keep `PUBLIC_URL` at its normal local app URL. The exact origin is required for the sign-in check.

Do not restart an existing Element on 8081 for this check. Verify the root sign-in page, a valid and an invalid login, a clinical read, Messages, and logout. Use a private disposable room containing only the test identity for any send. Read shared clinical rooms without posting. Delete only the temporary gateway container you created.
