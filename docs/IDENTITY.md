# Identity and misdelivery

This page covers how the outside person proves who they are, what we simulate, and how the request service catches the three misdelivery tests.

## What real ID Austria offers

ID Austria is the Austrian state electronic ID for people. Services connect to it over OpenID Connect or SAML2.

- **Two environments.** The reference environment has the issuer `https://idp.ref.id-austria.gv.at` and production has `https://idp.id-austria.gv.at`. Each publishes an OpenID Connect discovery document at `/.well-known/openid-configuration`.
- **A test environment exists.** The reference environment has predefined test identities, each with a public username and password.
- **Every service must register.** A service needs its own service provider entry, in the test environment and in production. Private companies register only through Mein USP, the government business portal, so you need a company with a USP account.
- **Test identities have odd names.** They are called "XXXOtto XXXOttakringer" and similar, so they never match a real person. They will not match the scenario's people either.
- **We found no lookup.** We found no public API that tells whether a person has ID Austria. A service learns about a person only when that person logs in.
- **Each organisation gets its own person number.** ID Austria derives a sector-specific person number (bPK) that cannot be traced back to the person's source PIN. Private service providers get one bPK per organisation, not per service. Two organisations cannot link a person's activity through it.
- **Full and basic function.** Full function means the identity was officially confirmed, at an authority or by an online upgrade with passport data. Some attributes are delivered only for full function.
- **How people log in.** With the ID Austria app (formerly Digitales Amt), with a FIDO key, or with EU-Login for foreign eIDs if the service enables it.
- **Healthcare providers.** Real ID Austria can also deliver `urn:eidgvat:attributes.gda`, the person's eHVD healthcare-provider entry. The claim is a string, the base64 of the entry as UTF-8 JSON, and has the same name in SAML2 and OpenID Connect. ID Austria sends it for full and basic function, but only when the person acts for themselves, not as a representative. A service can then compare the eHVD OID from the login with the eHVD instead of trusting the name. We simulate it for Eva Brandl.
- **Organisations have no ID Austria.** A lab or a clinic has no login. A person can act for a company, and the business portal handles that representation.
- **Not everyone has ID Austria.** An outside person without one, for example staff who live abroad, can log in with a foreign eID through EU-Login only if the service enables it. Such a login carries no `urn:pvpgvat:oidc.eid_ida_level`, so it fails our level check, and Dr. Hofer needs another route.

The OpenID Connect interface works like this, according to the official OIDC page and both discovery documents:

- Authorization code flow only. The client secret is mandatory and goes in the POST body (`client_secret_post`, the only method listed).
- PKCE with S256 is supported.
- The service asks for scope `openid profile`. The ID Austria claims belong to scope `profile`.
- There is no userinfo endpoint and no `end_session_endpoint`. Every claim arrives in the ID token.
- `sub` is transient. Only `urn:pvpgvat:oidc.bpk` identifies a person across logins.

The official sample ID token from the reference environment carries these claims, among others. `urn:pvpgvat:oidc.eid_ida_level` is not in the sample. Its values come from the official attribute page, which says it can be missing, for example for a person with a foreign eID.

| Claim | Example value | Meaning |
|---|---|---|
| `given_name` | `XXXŐzgür` | Given names, all of them |
| `family_name` | `XXXTüzekçi` | Family name |
| `birthdate` | `1983-06-04` | Birth date |
| `urn:pvpgvat:oidc.bpk` | `ZP-MH:KQMY8Sl9WsmBxrYrYOiFS2VkLyo=` | The person number (bPK). A sector prefix, a colon, and base64 of 20 bytes. |
| `urn:pvpgvat:oidc.eid_ida_level` | `urn:eidgvat:eid.status.full` | Full function, or `urn:eidgvat:eid.status.basic` |
| `urn:pvpgvat:oidc.eid_citizen_qaa_eidas_level` | `http://eidas.europa.eu/LoA/high` | eIDAS level of assurance. The token has no `acr`. |
| `urn:pvpgvat:oidc.eid_identity_status_level` | `http://eid.gv.at/eID/status/testidentity` | Marks a test identity |
| `urn:pvpgvat:oidc.pvp_version` | `2.2` | Version of the PVP attribute profile |
| `urn:eidgvat:attributes.gda` | Base64-encoded JSON | The person's eHVD entry, only for healthcare professionals acting for themselves. [eHVD](EHVD.md#id-austria-sends-the-ehvd-entry-at-login) has the details. |
| `sub` | `IFOQP3T5XYLMSDOQAEGMF52MWGMWBPXN` | Transient. Never use it to recognise a person. |

Brokers rename these claims. Signicat, for example, sends `nin`, `idaustria_level`, and `idaustria_authentication_level`. We use the names ID Austria itself sends, so the request service needs no claim mapping.

## What we simulate with Keycloak

We cannot register a service provider during the hackathon, so Keycloak plays ID Austria. The brief allows a simulated electronic ID.

Keycloak speaks the same protocol, OpenID Connect, and the realm sends the same claim names as real ID Austria. Switching to real ID Austria changes the metadata URL, the client id, and the client secret. The only simulator-specific code is the logout in [The login for T07](#the-login-for-t07), which real ID Austria skips because it has no `end_session_endpoint`.

| ID Austria feature | In Keycloak |
|---|---|
| Login page that sends the person back to the service | Authorization code flow, PKCE S256, client secret in the POST body |
| Name and birth date | `given_name`, `family_name`, `birthdate`. Only admins can edit them. |
| Person number | `urn:pvpgvat:oidc.bpk` from the user attribute `bpk`, a simulated health-sector bPK |
| Full or basic function | `urn:pvpgvat:oidc.eid_ida_level` from the user attribute `ida_level` |
| Level of assurance | `urn:pvpgvat:oidc.eid_citizen_qaa_eidas_level` from the user attribute `loa` |
| Test identity marker | `urn:pvpgvat:oidc.eid_identity_status_level`, always `http://eid.gv.at/eID/status/testidentity` |
| PVP version | `urn:pvpgvat:oidc.pvp_version`, always `2.2` |
| eHVD entry in the token | Simulated, for Eva Brandl only. `urn:eidgvat:attributes.gda` from the user attribute `gda`, which only admins can see and edit. |
| Identities come from the state | No self-registration. New test people come from `pnpm citizen`. |
| Look | Keycloak's own login theme, titled "ID Austria (Simulation)", English only, no official ID Austria logos |
| Phone-app confirmation | Not simulated. Keycloak would need a custom Java authenticator. |
| Qualified electronic signature | Not simulated. The task does not need it. |
| Acting for a company | Not simulated. The eHVD check covers the organisation. |

Keycloak differs from real ID Austria in ways the request service must not rely on:

- Keycloak's `sub` is the user id and stays the same across logins. Real `sub` is transient. Code that recognises people by `sub` would pass the demo and fail with real ID Austria.
- Keycloak's discovery also lists a userinfo endpoint, an `end_session_endpoint`, and more client authentication methods, including `client_secret_basic`. Real ID Austria has none of these.

### Realm setup

The realm `idaustria-sim` lives in `docker/keycloak/idaustria-sim-realm.json`. Keycloak 26.8.1 imports it at startup with `start-dev --import-realm`, but only when the realm does not exist yet. After editing the file, recreate the container with `docker compose up -d --force-recreate keycloak`. Keycloak keeps its data inside the container, so recreating it also removes the people added with `pnpm citizen`.

- The client `request-service` is confidential and allows only the authorization code flow. Its secret is `request-service-demo-2026`, the default of `OIDC_CLIENT_SECRET` in `src/env.ts` and its value in `.env.example`. Its redirect URI is `http://localhost:3010/auth/callback`. After logout it accepts the same URI (`post.logout.redirect.uris` is `+`).
- The client scope `profile` maps `given_name`, `family_name`, `birthdate`, and `urn:pvpgvat:oidc.bpk`. Keycloak answers `scope=openid profile` with `invalid_scope` unless a client scope named `profile` exists. The client itself maps the other four ID Austria claims and `urn:eidgvat:attributes.gda`. Every ID token carries the first eight. Only a person with a `gda` attribute gets the ninth, in the ID token and in userinfo.
- Mapper claim names escape their dots with a backslash, as in `urn:pvpgvat:oidc\.bpk`. Keycloak otherwise turns the dots into nested JSON objects.
- The user profile lets only admins edit `firstName` and `lastName`. Otherwise a person could rename themselves to "Eva Brandl" through `kc_action=UPDATE_PROFILE` and pass the name match. `email` is optional, because citizens have none, and a required email would send them to an "update profile" page.
- `birthdate`, `bpk`, `loa`, and `ida_level` are unmanaged attributes under `unmanagedAttributePolicy: ADMIN_EDIT`. Admins can edit them and citizens cannot. Without that policy, Keycloak drops them on import.
- The user profile declares `gda` as an attribute that only admins can view and edit. The update-profile page does not show it. If a citizen posts a `gda` field anyway, Keycloak shows the form again and stores nothing. The account console's API refuses every citizen. The realm's own citizens hold no roles and get 401. People from `pnpm citizen` hold the default roles and get 403, because the realm has no `roles` client scope that would put account roles in their token.
- Self-registration is off. Otherwise anyone could register a new account named "Eva Brandl" and pass the name match. Real ID Austria identities come from the state, so new test people come from `pnpm citizen`.
- An SSO session ends after 10 minutes without activity, and an access token lives 10 minutes.
- The admin console is at http://localhost:8080/admin, login `admin` / `keycloak-demo-2026`.

### Test citizens

| Username | Password | Name | Birth date | bPK | Plays |
|---|---|---|---|---|---|
| `eva.brandl` | `demo-eva` | Eva Brandl | 1979-05-14 | `GH:Njtp64gB10hpR5sYe6HxgmOQJk0=` | The requested lab physician |
| `stefan.kern` | `demo-stefan` | Stefan Kern | 1986-02-03 | `GH:RF6PDuDy01ECq3HwWVdsGZpNH4A=` | The requested discharge manager |
| `thomas.wagner` | `demo-thomas` | Thomas Wagner | 1982-07-21 | `GH:QQujzdblDRAvHut5+pFJYO61p04=` | Dr. Brandl's colleague in test M2 |
| `anna.huber` | `demo-anna` | Anna Huber | 1990-11-30 | `GH:2pgjERTxixGQaVB2gPMDZjQeI84=` | The owner of the mistyped address in test M1 |
| `eva.brandl2` | `demo-eva2` | Eva Brandl | 1968-09-09 | `GH:QqRyJqno/aFVJYjMxkWpDJWj878=` | A second Eva Brandl who is not in the eHVD |

All of them have full function and eIDAS level high. All names, dates, and passwords are synthetic.

Each bPK is `GH:` plus the base64 of the first 20 bytes of SHA-256 over `GH:<username>`. The username stands in for the person's source PIN. A person keeps the same bPK across re-imports, and the two Eva Brandls get different ones.

### The healthcare provider attribute

Only `eva.brandl` has a `gda` attribute, so only her token carries `urn:eidgvat:attributes.gda`. The other four are not in the eHVD. The value is the base64 of this UTF-8 JSON, her entry in the [eHVD mock](EHVD.md#directory-content). It keeps the register's German text as data.

```json
{"gda":{"id":{"oidIssuingAuthority":"1.2.40.0.34","id":"1.2.40.0.34.3.2.99.1.2"},"status":{"ehvdstatus":"Aktiv","elgastatus":"Aktiv"},"firstname":"Eva","surname":"Brandl","title":"Dr.","description":["Registrierungsstelle:Österreichische Ärztekammer"],"roles":{"role":["1.2.40.0.34.5.2:159"],"elgaRole":["1.2.40.0.34.5.3:700"],"specialisation":["1.2.40.0.34.3.1.10.20:19"]},"timestamps":{"add":"2019-03-01","modify":"2026-01-15"}}}
```

`gda.id.id` is her eHVD OID. The entry does not say which lab she works for. The request service looks that up in the eHVD by the OID.

### Add a test citizen

```bash
pnpm citizen --given Peter --family Muster --birthdate 1970-01-01
```

The script adds the person through the Keycloak admin API and prints the username, the password, the bPK, and the eHVD OID. The username defaults to `peter.muster` and the password to `demo-peter`. It refuses a username that already exists and changes nothing.

| Option | Values | Default |
|---|---|---|
| `--loa` | `high`, `substantial`, `low` | `high` |
| `--ida-level` | `full`, `basic`, `none` | `full`. With `basic`, the person fails the level check. `none` stands for a foreign eID through EU-Login, which carries no level and fails too. |
| `--gda-oid` | an OID, such as `1.2.40.0.34.3.2.99.9.9` | none. With it, the person gets a `gda` attribute in the same shape as Eva Brandl's, with `oidIssuingAuthority` `1.2.40.0.34`, this OID as `id`, status `Aktiv` and `Aktiv`, and the given and family name. Their token then carries `urn:eidgvat:attributes.gda`. The script accepts only an OID, at least two dot-separated numbers without leading zeros. As ITU-T X.660 defines, the first number is 0, 1, or 2, and when the first is 0 or 1, the second is below 40. |
| `--username`, `--password` | any | from the given and family name |

It reads the Keycloak address and realm from `OIDC_METADATA_URL` and the admin login from `KEYCLOAK_ADMIN_USER` and `KEYCLOAK_ADMIN_PASSWORD`. The bPK uses the same derivation as the realm's citizens.

The extra test set adds two senders with double names this way, Sophie Lindner-Pichler (`sophie.lindner-pichler` / `demo-sophie`) and Karl Heinz Moser-Wallner (`karl-heinz.moser-wallner` / `demo-karl`). [`track/scenario/extra/index.md`](../track/scenario/extra/index.md) has their commands, whom they play, and the name-match cases they test. A given name with a space needs quotes: `--given "Karl Heinz"`.

## How the login connects to the request service

```
 Browser                      Request service                    Keycloak
    |-- GET /r/{token} --------->| link_opened                      |
    |<-- neutral page -----------|                                  |
    |-- POST /auth/login ------->|                                  |
    |<-- redirect (state, nonce, PKCE S256, prompt=login) ----------|
    |-- username + password ----------------------------------------->|
    |<-- redirect to /auth/callback?code=...&state=... --------------|
    |-- GET /auth/callback ----->|                                  |
    |                            |-- code, secret, PKCE verifier -->|
    |                            |<-- ID token (signed) ------------|
    |                            | verify signature, nonce, expiry  |
    |                            |-- logout POST (simulator only) ->|
    |                            | identity checks, identity_checked|
    |<-- answer form or refusal -|                                  |
```

The request service never sees the password. Keycloak signs the ID token with its private key, and the request service checks it with Keycloak's public key, so the person cannot change their own name. The code swap runs server to server with a secret the browser never sees. The library `openid-client` does the redirects, the code swap, and the signature check inside two Next.js route handlers.

### The login for T07

The route handlers must do the following, so the same code works with both the simulator and real ID Austria:

- Read the provider from `OIDC_METADATA_URL` through discovery.
- Send `scope=openid profile`, `state`, `nonce`, a PKCE challenge with `code_challenge_method=S256`, and `prompt=login`.
- Swap the code with `client_secret_post`, which sends `client_id` and `client_secret` in the POST body. Send the PKCE verifier too. Real ID Austria accepts no other client authentication method.
- Verify the ID token's signature against the discovered keys (Keycloak signs with RS256), and its issuer, audience, nonce, and expiry. Take every claim from the ID token. Real ID Austria has no userinfo endpoint. openid-client checks the signature of an ID token from the token endpoint only after `enableNonRepudiationChecks`. Without it, the library relies on TLS alone, so we turn it on.
- Read the person number from `urn:pvpgvat:oidc.bpk`, the function level from `urn:pvpgvat:oidc.eid_ida_level`, the eIDAS level from `urn:pvpgvat:oidc.eid_citizen_qaa_eidas_level`, the eHVD entry from `urn:eidgvat:attributes.gda`, and `given_name`, `family_name`, and `birthdate`. Never use `sub`. `loginFromClaims` in `src/server/auth/id-austria.ts` parses the claims into the `LoginIdentity` that the identity checks read: the person number, the names, the function level as received, and the eHVD OID. No check needs the eIDAS level or the birth date yet, so they stay in the stored ID token, where the Provenance reads them. A missing name fails the login. A missing bPK, a level other than full function, or an unreadable `urn:eidgvat:attributes.gda` fails an identity check instead, so it counts toward the lock and Dr. Hofer gets a notice.
- Decode `urn:eidgvat:attributes.gda` with `gdaOidFromClaim` from `src/server/auth/eid-session.ts`. It returns the OID from `gda.id.id`, `null` when the token has no such claim, or an `Error` when the claim is present but is not base64 of UTF-8 JSON whose `gda.id.id` is an OID. It checks the OID with the same rule as `pnpm citizen`, from `src/server/ehvd/oid.ts`. It accepts only padded standard base64, as the ID Austria page describes. If real ID Austria sends the claim unpadded or as base64url, loosen the decoder then. Treat the `Error` as a failed identity check, never as a person without an eHVD entry. Store the OID as `gdaOid` and look up the person and their lab in the eHVD by it.
- Keep the ID token exactly as received, for the Provenance signature. It stays on the server, on the request row in Postgres, which the Provenance needs anyway. The callback stores it in `requests.id_token` with `saveIdToken` from `src/server/requests/service.ts`. A cookie with the token inside came to about 3.4 KB for Eva Brandl, close to the 4096-byte limit, and real eHVD entries can be longer than hers. The session cookie holds only the small fields, 345 bytes for Eva Brandl.
- End the Keycloak session right after the signature check, before the identity checks, so people who fail a check are logged out too.

The logout matters when several people log in through the same browser, as jury members do. After a login, the next person gets the previous person's locked username form with `prompt=login`. Without `prompt=login`, Keycloak signs them in silently as the previous person. To end the session, POST `client_id`, `client_secret`, and the `refresh_token` from the token response to the discovered `end_session_endpoint`. Keycloak answers 204, and the next person gets a normal form. This is Keycloak's own legacy format and works only with the simulator. Real ID Austria lists no `end_session_endpoint`, so skip the call when discovery has none. A failed logout is logged and does not stop the login. With `prompt=login`, the next person still has to type a password.

`src/server/auth/id-austria.ts` holds the discovery, the authorization URL, the code swap, the logout, and `loginFromClaims`. The route handlers in `src/app/auth/login/route.ts` and `src/app/auth/callback/route.ts` call it.

- Discovery runs once per server process. A failed discovery is not kept, so the next login tries again.
- openid-client allows plain http only when `OIDC_METADATA_URL` is `http:` on `localhost` or `127.0.0.1`, which is the simulator. Real ID Austria is https.
- `/auth/login` puts the link token, `state`, `nonce`, and the PKCE verifier into the cookie `ordy_eid_login`. It is a JWT signed with `ORDY_SECRET`, like the session, and expires after 10 minutes. Its flags are `HttpOnly`, `SameSite=Lax`, `Secure` when `PUBLIC_URL` is https, and `Path=/auth/callback`. `Lax` lets the cookie through on the redirect back from real ID Austria, a cross-site top-level GET. With the simulator on `localhost`, the redirect is same-site. The callback deletes it on every outcome.
- The landing page starts the login with a POST form, so link prefetching and other sites cannot start one. `/auth/login` refuses a POST whose `Origin` is not the origin of `PUBLIC_URL`, and sends every redirect with 303.
- `/auth/login` also deletes any `ordy_eid_session`, so a new login drops the previous person's session.
- The callback builds the URL for the code swap from `PUBLIC_URL`, not from the request URL. openid-client sends that URL without its query as `redirect_uri`, which must equal the one from `/auth/login`.
- The callback looks up the request again after the code swap, because it may have been answered, locked, or expired during the login.
- After the logout, the callback runs `runIdentityChecks` and sends the person to the page for its result, built with `portalPath` from `src/server/portal/paths.ts`: `/r/{token}/answer`, `/held`, `/refused`, `/unavailable`, or `/r/{token}` for a link that no longer works.
- Only a login that leaves the request bound to this person stores the ID token and gets a session, `bound` in the result of `runIdentityChecks`: a login that lands on the answer page, or a hold that stored their bPK on a `sent` request. A pass while Dr. Hofer decides lands on the held page without either. A wrong person never replaces the token of the right one, and nobody else gets a session.
- The callback sets `ordy_eid_session` with `HttpOnly`, `SameSite=Lax`, `Secure` when `PUBLIC_URL` is https, `Path=/`, and a lifetime of 30 minutes.

A failed login lands on one of these pages. When a step throws, the request service logs a short reason. It never logs tokens, claims, or names. For a database error it logs only the error code, because the message lists the query parameters.

| Failure | Lands on |
|---|---|
| `/auth/login` has no `token` or a foreign `Origin`, or the callback has no valid `ordy_eid_login` | `/auth/failed`, "This login has expired" |
| The link token finds no open request, at login or again at the callback | `/r/{token}`, "This link does not work" |
| Discovery, the code swap, or a token check fails, or a name claim is missing | `/r/{token}?login=failed`, "The login did not work. Try again." above the login button |
| Keycloak cannot be reached, does not answer in time, or answers 502, 503, or 504 during the callback | `/r/{token}/unavailable`, after `identity_checked` with `hold` and `keycloak_unreachable` |

The login and the callback find the request with `findOpenRequest` from `src/server/portal/data.ts`. It returns the request only while its link still works.

## Identity checks

The request service runs four checks after login: the level, the name, the person number, and the eHVD claim. Once a request is bound to a person, a fifth one, the request person, runs too. They make sure the right person answers. It shows the patient and the document type only if the result is pass. One more check, the release check, runs when the answer arrives and makes sure the person responsible for the content released it. [Who may release a document](#who-may-release-a-document) describes it.

| Check | Pass | Hold | Fail |
|---|---|---|---|
| Level | `urn:pvpgvat:oidc.eid_ida_level` is `urn:eidgvat:eid.status.full` | | Basic or missing |
| Name | All requested name words are in the ID Austria name | The family names share a word but do not match fully | No shared family name word |
| Person number | No binding yet, or the binding matches `urn:pvpgvat:oidc.bpk` | | A binding exists for this person and organisation with a different bPK, or the token has no bPK |
| eHVD claim | No `urn:eidgvat:attributes.gda`, or one that `gdaOidFromClaim` reads | | The claim is present but malformed |
| Request person, only for a request that is `verified` or `answer_held` | `urn:pvpgvat:oidc.bpk` equals `requests.person_number` | | Another bPK. Only the person who passed, or whom Dr. Hofer accepted, may answer. Also an empty `requests.person_number`, so broken data fails closed. |

Any fail blocks the person, writes `identity_checked` with `fail` and `misdelivery_caught` with `wrong_person`, adds one to `failed_checks`, and tells Dr. Hofer. When the name failed, she gets the wrong-person notice from [M1](#m1-wrong-address) and [M2](#m2-forwarded-request). When the name matched and another check failed, the person may be the right one with the wrong login, so the notice gives the reason, for example "Request 1 was opened by Eva Brandl, but the identity check failed. The ID Austria login has only basic function, and a request needs full function. Nothing was shown or filed."

A hold with a logged-in person sets a `sent` request to `identity_held` and stores the person's bPK in `requests.person_number`. Three things hold: a name that matches only in part, a requested name with no words, and an unreachable eHVD. Dr. Hofer accepts or rejects the person in the widget. **Accept** moves the request to `verified` and keeps that bPK, so the accepted person passes from then on even though her name still matches only in part, and anyone else fails the request person check.

A login changes the state only while the request is `sent`, as the lifecycle table says:

| Request state | Pass | Hold | Fail |
|---|---|---|---|
| `sent` | `verified`, stores the bPK, answer page | `identity_held`, stores the bPK, held notice | unchanged, `locked` on the third fail |
| `identity_held` | unchanged, held page | unchanged, held page, no notice, the held person stays | unchanged, counted |
| `verified` | unchanged, answer page | none: the bound person's hold counts as a pass (answer page), anyone else fails the request person check | unchanged, counted |
| `answer_held` | unchanged, held page | none: the bound person's hold counts as a pass (held page), anyone else fails the request person check | unchanged, counted |
| any other | no check runs; the link does not work | | |

A pass or a hold of the person `requests.person_number` names, in `verified` or `answer_held`, counts as a pass: Dr. Hofer accepted them, or they passed before. A fail still fails.

If Keycloak or the eHVD cannot be reached, the request service treats it as a hold, never as a pass, except for the person the request is bound to, as above. A fail still wins over an outage.

- **Keycloak unreachable.** There is no verified person, so there is nobody for Dr. Hofer to accept. The request service writes `identity_checked` with `hold` and the reason `keycloak_unreachable`, keeps the state, and asks the person to try again later. The attempt does not count toward the lock.
- **eHVD unreachable.** The person logged in, so the request goes to `identity_held`, and Dr. Hofer gets "Request 1 is on hold. The eHVD could not be reached to confirm Eva Brandl. Accept or reject the person in the widget."

The checks live in `src/server/identity/checks.ts`. Each returns `pass`, `hold`, or `fail` with a reason code, and `identity_checked` stores the list of checks as `{ check, result, reason }` in `detail`. `misdelivery_caught` stores only the failed checks. `src/server/identity/login.ts` turns the result into the transition, the audit entries, the page the person sees, and the notice. The callback calls `runIdentityChecks` from there right after it ends the Keycloak session. The request core passes in five ports (`IdentityCheckPorts`):

- `findBinding` reads `bindings` for the requested name and organisation.
- `recordAudit` writes an audit entry.
- `incrementFailedChecks` adds one to `failed_checks` in one statement, `UPDATE … SET failed_checks = failed_checks + 1 … RETURNING failed_checks`, and returns the new count. The lock follows from that count. Reading the count and writing it back would let logins at the same time all write 1, and none would lock.
- `transition` applies a change only while the request is still in its `from` state (`… WHERE state = 'sent'`) and stores the bPK in the same statement. It returns false when the state changed in between. Then the person sees "try again", and a lost hold sends no notice: nobody would ever decide on a hold that was not applied. The next login is checked against the new state.
- `notify` posts the notice with `notifyRoom`. A failed notice never changes what the person sees.

### Name match

ID Austria returns the full official name. Dr. Hofer types what she knows. The match tolerates extra names, double names, titles, and spelling of umlauts.

| Dr. Hofer typed | ID Austria returns | Result |
|---|---|---|
| Eva Brandl | Eva Maria Brandl | Pass. An extra given name is fine. |
| Eva Brandl | Eva Brandl-Huber | Pass. A double family name contains Brandl. |
| Eva Mueller | Eva Müller | Pass. Both spell out to `mueller`. |
| Dr. Eva Brandl | Eva Brandl | Pass. Titles are ignored, also female forms such as `Dr.in` and `Mag.a`. |
| Eva Brandl-Huber | Eva Brandl | Hold. The family names share only Brandl. |
| Eva Brandl | Petra Brandl | Hold. Same family name, different given name. |
| Eva Brandl | Eva Huber | Fail. A married name change also fails, and Dr. Hofer can send a new request. |
| Eva Brandl | Thomas Wagner | Fail |

```ts
// Dr., DDr., Dr.in, Mag.a, Univ.-Prof., Dipl.-Ing., Prim. Joined titles need a dot or hyphen between them
// and the female ending needs its dot, so "Magdi" and "Dia" stay names.
export const TITLE = /^(?:d?dr|mag|prof|univ|med|di|ing|dipl|prim)(?:\.(?:in|a))?(?:[.-]+(?:d?dr|mag|prof|univ|med|di|ing|dipl|prim)(?:\.(?:in|a))?)*\.?$/i;
const SPELL_OUT: Record<string, string> = { "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss" };

function plainWords(text: string): string[] {
  return text
    .replace(/[äöüß]/g, (c) => SPELL_OUT[c])
    .replace(/[-.,]/g, " ")
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

export function nameWords(name: string): Set<string> {
  // NFC first: a decomposed "ü" would otherwise lose its umlaut instead of becoming "ue".
  const tokens = name.normalize("NFC").toLowerCase().split(/\s+/).filter(Boolean);
  const untitled = tokens.filter((t) => !TITLE.test(t.replace(/,+$/, ""))); // also "Beispiel, Dr.in, Maria"
  const words = plainWords(untitled.join(" ")).filter((w) => !TITLE.test(w)); // also "Dr.Eva" without a space
  // A name made only of title-like words, such as the given name "Di", keeps them.
  return new Set(words.length ? words : plainWords(tokens.join(" ")));
}

const isSubset = (a: Set<string>, b: Set<string>) => [...a].every((w) => b.has(w));
const shares = (a: Set<string>, b: Set<string>) => [...a].some((w) => b.has(w));

export function matchRequestedPerson(reqGiven: string, reqFamily: string, idGiven: string, idFamily: string) {
  const wantFamily = nameWords(reqFamily), gotFamily = nameWords(idFamily);
  if (isSubset(wantFamily, gotFamily) && isSubset(nameWords(reqGiven), nameWords(idGiven))) return "pass";
  if (shares(wantFamily, gotFamily)) return "hold";
  return "fail";
}
```

`isSubset(a, b)` means every word in `a` is also in `b`. The request procedure refuses requests with an empty given name or family name, because an empty set passes every subset test. For the same reason `nameWords` never strips a name down to nothing: a name made only of title-like words, such as the given name "Di", keeps them. A requested name with no words at all, such as "-", still never passes: the name check holds it with the reason `requested_name_empty`.

`nameWords`, `isSubset`, and `shares` live in `src/server/identity/names.ts`, and `matchRequestedPerson` in `src/server/identity/checks.ts`. `checks.test.ts` reads the table above from this file and runs every row, so keep its three columns and the "Pass", "Hold", or "Fail" at the start of the result.

### Person number binding

After the first answer that gets filed, the request service stores the bPK from `urn:pvpgvat:oidc.bpk` for the requested name and organisation in the `bindings` table. On the next request to "Eva Brandl at Labor Kanalstraße", only that bPK passes. A second Eva Brandl then fails the person number check even if she receives the link.

Never bind `sub`. Real ID Austria sends a transient `sub`, so a binding on it would lock out the right person at her next login.

### What we need about the outside person

| From | Data |
|---|---|
| Dr. Hofer, in the request | Given name, family name, email or phone, organisation |
| The outside person | An ID Austria login, access to the inbox or phone, a browser, and the document |
| ID Austria, at login | Verified name, birth date, person number, function level, time |
| The answer form | The patient's name and birth date, and the document |

We do not need the person's birth date, their ID Austria number, or an account in advance. Dr. Hofer does not have those, and no public register lists a doctor's birth date.

## Who may release a document

Only the people who are professionally responsible for a document's content may release it. The sender can be someone else, for example discharge management. So the request service checks two people: the sender, with the identity checks above, and the person responsible for the content, with the release check below.

This is our reading of Austrian law for a hackathon prototype, not legal advice. Doc 1 checks it.

### Legal basis

| Rule | Source | What follows for ordy |
|---|---|---|
| Examining people for illnesses and assessing the results with medical diagnostic aids is reserved for physicians. | § 2 Abs 2 Z 1 and 2 ÄrzteG 1998 | A medical lab report and a discharge letter are physicians' documents. |
| Specialists must limit their work to their specialty. | § 31 Abs 3 ÄrzteG 1998 | The releasing physician's specialty must cover the content. For lab reports, the specialty "Medizinische und Chemische Labordiagnostik" has the broadest authority. Other specialties may release only tests that belong to their training, for example microbiology. |
| Biomedical scientists (BMA) may produce a "biomedical-analytical finding" on their own, after a medical order: plausibility checks, comparison with earlier values. Diagnoses and treatment recommendations stay with physicians. | §§ 4 Abs 2 Z 1 lit d, 5 Abs 1 MTD-Gesetz 2024; Stöger et al., RdM 2025/38 | A value released only by a BMA is a biomedically validated result, not a medical lab report. A comment such as "INR and aPTT are raised, as expected under anticoagulation" needs a physician. |
| A lab that is an outpatient clinic must be run by a qualified physician. A lab in a hospital must be run by a specialist of the relevant specialty. That physician answers for the quality of all lab work. | §§ 7, 8 KAKuG and the state laws | The lab's medical lead is responsible even when someone else does the analysis. |
| At discharge, a hospital writes a discharge letter with what further care needs. Rehab centres are special hospitals, so this applies to them too. | § 24 Abs 2 KAKuG | The discharge letter is the rehab clinic's medical document. The physician who signs it is responsible for it. Others may send it. |
| In ELGA, a lab report is the specialist-signed, commented or interpreted report. Its legal signer is typically the medical validator or the physician responsible for the lab. A medical discharge letter is signed by the responsible physician. | ELGA CDA guides "Laborbefund" v2.06.3 (3.3.4, 3.3.5) and "Entlassungsbrief (Ärztlich)" v2.06.5 | We treat the person named under `Validated by` or `Written by` as the legal signer and check them. |

### The release check

The release check runs when the answer arrives, after the patient check.

| Document | Responsible for the content | Named in the document as | The eHVD must show |
|---|---|---|---|
| Lab result | A physician whose specialty covers the tests. For clotting, haematology, and clinical chemistry: a specialist in medical and chemical laboratory diagnostics. | `Validated by` | An active entry with `specialisation` `1.2.40.0.34.3.1.10.20:19`, member of the lab that sent the report |
| Rehab discharge report | The physician who wrote and signed it for the rehab clinic | `Written by` | An active physician (`elgaRole` `1.2.40.0.34.5.3:700`), member of the rehab clinic, and the rehab clinic itself active as a hospital (`role` 300 or 301) |

How the request service finds the responsible person in the eHVD:

- If the responsible person is the sender and the login carried the GDA claim, it uses the OID from the claim. That is the usual case for lab results.
- Otherwise it searches the eHVD for the name from the document and keeps active entries that are members of the organisation. Exactly one hit counts. [eHVD](EHVD.md#how-ordy-uses-the-ehvd-t15) has the calls.

The Provenance names the responsible person as `author` and the sender as `informant` when they differ. [FHIR model](FHIR.md#provenance) has the details.

### Block or hold

The two kinds of checks fail differently:

- **Block**, when the identity checks fail. The wrong person opened the link, for example in M1 and M2. They see nothing, cannot answer, and nothing is stored. Dr. Hofer gets a message.
- **Hold**, when the release check does not pass. The right person answered, but the eHVD does not confirm that the responsible person may release this document. Reasons: not listed, not active, another specialty, not a member of the organisation, or several people with that name. The request service keeps the answer in `held_answers` but files nothing. Dr. Hofer gets a Matrix message with the reason and accepts or rejects the answer in the widget. An error in the release check, an unreachable eHVD included, holds too. [The answer](ARCHITECTURE.md#the-answer) has the steps.

We hold instead of blocking because the eHVD can be out of date, and a physician of another specialty can be responsible for some tests. Dr. Hofer, a physician, makes that call. If she accepts, `answer_filed` records who accepted (`acceptedBy`) and when (`at`), and the Provenance carries the policy `urn:aim-t2:identity-policy:accepted-by-requester:v1`. If she rejects, the request is `cancelled` and the held answer is deleted.

## The eHVD

The eHealth directory (eHVD) lists every person and organisation in Austria that works as a healthcare provider, with name, roles, specialties, practice addresses, membership in organisations, and whether they may currently practise (`Aktiv` or `Inaktiv`). [eHVD](EHVD.md) describes the real SOAP interface and our mock in detail.

What matters for identity:

- For healthcare professionals, ID Austria can send the eHVD entry at login (`urn:eidgvat:attributes.gda`). The eHVD OID in the claim then links the login to the directory entry through the state. Keycloak sends it for `eva.brandl`.
- Without the claim, the name is the only link, because the eHVD has no birth date and no person number.
- People who are not healthcare professionals, such as a discharge manager, are not listed as persons. Their organisation is.
- The claim has no organisation membership. The request service asks the eHVD for the entry's `memberof`.
- The real web service needs a registration with the health ministry and an IP allowlist entry at BRZ. That does not fit into a hackathon, so we run a mock with the same interface in its own container.

The mock holds Labor Kanalstraße, Reha Waldblick, Klinikum Beispielstadt, Dr. Eva Brandl, Dr. Johanna Leitner, Dr. Lena Hofer, two other people named Brandl, the official test entries, and generated filler entries. [eHVD](EHVD.md#directory-content) has the full list with OIDs.

Stefan Kern and Thomas Wagner are not listed. The second Eva Brandl is not listed either. The simulated ID Austria sends `1.2.40.0.34.3.2.99.1.2` in Eva Brandl's `urn:eidgvat:attributes.gda`, the same OID as her entry here.

## Misdelivery tests

All three run on request 1, Dr. Brandl by email. A test counts if its condition holds and the audit log has the event.

### M1: wrong address

Dr. Hofer types `eva.brandl@labor-kanaI.example`, with a capital I.

1. The address check sees that the domain differs from `labor-kanal.example` in the eHVD. The widget warns Dr. Hofer, and the request service writes `misdelivery_caught` with `address_mismatch`.
2. For the test, Dr. Hofer clicks **Send anyway**.
3. Anna Huber opens the email in Mailpit and clicks the link. The page shows only "Dr. Lena Hofer at Klinikum Beispielstadt sent you a request".
4. She logs in as `anna.huber`. The name check fails.
5. She sees "This request is for someone else. Nothing was shared with you." She never sees the patient or the document type, and she cannot answer.
6. The audit log has `identity_checked` with `fail` and `misdelivery_caught` with `wrong_person`. Dr. Hofer gets a Matrix message.

### M2: forwarded request

Dr. Brandl forwards the email to `kollege@labor-kanal.example`.

1. Thomas Wagner opens the link and logs in as `thomas.wagner`.
2. The name check fails. He sees nothing and cannot answer.
3. The audit log has `identity_checked` with `fail` and `misdelivery_caught` with `wrong_person`. Dr. Hofer gets "Request 1 was opened by someone who is not Dr. Eva Brandl (ID Austria name: Thomas Wagner)".
4. The link still works for Dr. Brandl until three checks have failed.

### M3: wrong patient

Dr. Brandl logs in and uploads `lab-result-max-beispiel.md`, a result for Max Beispiel, born 1 January 1960.

1. The parser reads "Max Beispiel" and 1960-01-01 from the document.
2. The patient check fails. Neither the birth date nor the given name matches Maria Beispiel.
3. Nothing is filed. Dr. Brandl sees "This document is about a different patient. Check the file and upload again." The request stays `verified`, so she can upload the right file. If the document is right and only the name or birth date she typed is wrong, she sees "The name or birth date you entered does not match the patient of this request. Check them and send again." instead. Nothing was misdelivered then, so neither the audit log beyond `answer_sent` nor Dr. Hofer hears of it.
4. The audit log has `answer_sent` with the upload's hash, then `misdelivery_caught` with `patient_mismatch`, the same hash, and `nameMatches` and `birthDateMatches` for the document. Dr. Hofer gets a Matrix message that names Maria and does not name Max.
5. The request service discards the upload and keeps only its SHA-256 hash.

```ts
export function samePatient(docName: string, docBirthDate: string, patient: { family: string; given: string[]; birthDate: string }) {
  const family = nameWords(patient.family);
  if (!family.size || !patient.birthDate) return false;
  const allNames = new Set([...family, ...nameWords(patient.given.join(" "))]);
  const docWords = nameWords(docName);
  return docBirthDate === patient.birthDate && isSubset(family, docWords) && isSubset(docWords, allNames);
}
```

The request service runs this check on the document and on the name and birth date typed into the form. Both must pass. The code is in `src/server/documents/patient-check.ts`, and `nameWords` is in `src/server/identity/names.ts`.

## Sources

- [ID Austria predefined test identities](https://www.id-austria.gv.at/de/developer/testen/vordefinierte-testidentit%C3%A4ten)
- [ID Austria: testing on mobile devices](https://www.id-austria.gv.at/de/developer/testen/testen-auf-mobilen-ger%C3%A4ten)
- [ID Austria: connecting via SAML2 (PVP2 S-Profil)](https://www.id-austria.gv.at/de/developer/anbinden/anbindung-via-saml2-(pvp2-s-profil))
- [ID Austria whitepaper for service owners v1.4](https://www.id-austria.gv.at/dam/jcr:af50dfdb-d7d3-4e98-bfe7-f2dc0b1dec36/ID-Austria-Whitepaper-Service-Owner-v1.4.pdf)
- [ID Austria technical background v1.4](https://www.id-austria.gv.at/dam/jcr:f86f12a4-87fb-44d6-89a2-e5111a388577/ID-Austria-Technische-Hintergrundinformationen-v1.4-1.pdf)
- [ID Austria whitepaper for end users](https://www.id-austria.gv.at/dam/jcr:1ee37fa4-5781-4db3-9839-b12417bd917f/ID-Austria-Whitepaper-fuer-EndanwenderInnen.docx.pdf)
- [USP: registering as an ID Austria service provider](https://www.usp.gv.at/hilfe-und-support/verfahrensrechte/registrierung-als-ida-sp.html)
- [USP: ID Austria for companies and public bodies](https://www.usp.gv.at/themen/betrieb-und-umwelt/laufender-betrieb/weitere-informationen-laufender-betrieb/id-austria-fuer-unternehmen-und-behoerden.html)
- [USP: company representation with ID Austria](https://www.usp.gv.at/ueber-das-usp/infos-fuer-verfahrenspartner/ida-anbindung.html)
- [ID Austria: connecting via OpenID Connect](https://www.id-austria.gv.at/de/developer/anbinden/anbindung-mit-openid-connect), with the official sample ID token
- [ID Austria reference environment discovery](https://idp.ref.id-austria.gv.at/.well-known/openid-configuration) and [production discovery](https://idp.id-austria.gv.at/.well-known/openid-configuration)
- [ID Austria: person attributes](https://www.id-austria.gv.at/de/developer/registrieren/personenmerkmale)
- [ID Austria attribute: ID Austria level](https://www.id-austria.gv.at/de/developer/registrieren/personenmerkmale/ID-Austria-Level)
- [ID Austria attribute: authentication level](https://www.id-austria.gv.at/de/developer/registrieren/personenmerkmale/Authentifizierungslevel)
- [ID Austria attribute: healthcare provider](https://www.id-austria.gv.at/de/developer/registrieren/personenmerkmale/Gesundheitsdiensteanbieter)
- [ID Austria: private service providers](https://www.id-austria.gv.at/de/developer/registrieren/private-sps)
- [ID Austria: authentication factors](https://www.id-austria.gv.at/de/hilfe/hilfe-zu-ida/authentifizierungsfaktoren)
- [USP: the ID Austria app replaces Digitales Amt](https://www.usp.gv.at/hilfe-und-support/anmeldung/id-austria-app-neu.html)
- [Signicat: ID Austria OIDC attributes](https://developer.signicat.com/identity-methods/id-austria/attributes-reference/id-austria-attributes-oidc/), the broker's renamed claims
- [chil.at: a public ID Austria SAML2 test service provider](https://chil.at/projects/2025-07-31_id-austria-service-provider-test/saml/)
- [BMF: supplementary register for natural persons](https://www.bmf.gv.at/ministerium/aufgaben-und-organisation/Stammzahlenregisterbehoerde/Ergaenzungsregister.html)
- [eHVD web service handbook v2.4](https://www.gesundheit.gv.at/dam/gesundheitgvat/professional/it-services/ehvd/eHVD-ServicehandbuchV2.4.pdf), sections 2, 3.2, 3.3.2, and 5.2
- [ID Austria: attribute "Gesundheitsdiensteanbieter"](https://www.id-austria.gv.at/de/developer/registrieren/personenmerkmale/Gesundheitsdiensteanbieter)
- [eHVD](EHVD.md) lists all sources on the eHVD interface
- [Ärztegesetz 1998, § 2 and § 31](https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10011138)
- [MTD-Gesetz 2024, §§ 4 and 5](https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=20012653)
- [Krankenanstalten- und Kuranstaltengesetz, § 24](https://www.ris.bka.gv.at/eli/bgbl/1957/1/P24/NOR40211928)
- [Stöger, Wagner, Griesmacher, Hörmann: Biomedizinisch-analytische und ärztliche Befundung, RdM 2025/38](https://biomed-austria.at/sites/default/files/uploads/St%C3%B6ger%20et%20al%20Befundung%20BMA_RdM%2025-38.pdf), and the [reply by Biomed Austria](https://biomed-austria.at/sites/default/files/uploads/Stellungnahme_St%C3%B6ger%20et%20al%20Befundung%20BMA_RdM%2025-38_Biomed%20Austria_0.pdf)
- [ELGA CDA implementation guide: lab report v2.06.3](https://www.gesundheit.gv.at/dam/jcr:850c95f5-438a-40e4-864c-30839c3b49ea/Implementierungsleitfaden_Laborbefund_V2.06.3.pdf)
- [ELGA CDA implementation guide: medical discharge letter v2.06.5](https://www.gesundheit.gv.at/dam/jcr:ca65e81f-caff-410d-b6fb-0d83c3df5054/Implementierungsleitfaden_Entlassungsbrief_%C3%84rztlich_V2.06.5.pdf)
- [GDA-Index glossary entry](https://www.gesundheit.gv.at/lexikon/G/gda-index.html)
- [ELGA guide for laboratory medicine v2.0](https://www.elga.gv.at/fileadmin/user_upload/Dokumente_PDF_MP4/Technisches/Leitfaden_ELGA_f%C3%BCr_Labormedizin_V2.0.pdf)
- [Keycloak server administration guide](https://www.keycloak.org/docs/latest/server_admin/index.html)
- [Keycloak: importing and exporting realms](https://www.keycloak.org/server/importExport)
