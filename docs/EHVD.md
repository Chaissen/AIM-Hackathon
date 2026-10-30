# eHVD: the real interface and our mock

The eHealth directory (eHVD, eHealth Verzeichnisdienst) lists every person and organisation in Austria that works as a healthcare provider (GDA, Gesundheitsdiensteanbieter). Registration bodies such as the medical chamber keep it current. ordy uses it to confirm roles, such as "active lab physician at Labor Kanalstraße", and to check email domains before sending.

The real web service needs a registration with the health ministry and an IP allowlist entry at BRZ, so we cannot call it during the hackathon. We build a mock that behaves like the real service in every documented way. This page records what is public about the interface, which gaps we fill and how, and what the mock contains.

Status: the mock is built (T23) and runs as the container `ehvd`. The client in ordy, the address check, and the release check are built (T15, `src/server/ehvd/`). The request procedure calls the address check once T04 is in, and the answer flow calls the release check with T13. See [Timeline](TIMELINE.md).

## Sources and what they give us

| Source | What it gives us |
|---|---|
| [eHVD web service handbook v2.4](https://www.gesundheit.gv.at/dam/gesundheitgvat/professional/it-services/ehvd/eHVD-ServicehandbuchV2.4.pdf), BRZ, 14 September 2026, classified as public | Transport, endpoints, both methods, field tables, allowed characters, wildcard rules, fault codes, three test entries, access process |
| `wsdl/eHVD.wsdl` in the open-source MOA-ID module `moa-id-module-ehvd_integration` 4.1.5.3 by EGIZ ([Maven](https://apps.egiz.gv.at/maven/MOA/id/server/modules/moa-id-module-ehvd_integration/4.1.5.3/), [source](https://git.egiz.gv.at/moa-id-spss/)) | The deployed WSDL, "Service: eHVD, Version: 2, Owner: BRZ": exact element names, namespace, element order, SOAP actions. Our copy: [`ehvd/eHVD.wsdl`](ehvd/eHVD.wsdl) |
| [Austrian terminology server](https://termgit.elga.gv.at/) | The code systems behind roles and specialties |
| [OID concept for Austrian healthcare](https://www.gesundheit.gv.at/OID_Frontend/oid-frontend/static/OID_Konzept_1-1-0.pdf) | The OID tree that eHVD ids come from |
| [ID Austria: attribute "Gesundheitsdiensteanbieter"](https://www.id-austria.gv.at/de/developer/registrieren/personenmerkmale/Gesundheitsdiensteanbieter) | ID Austria can send a person's eHVD entry at login |

Not public, so the mock has to choose (see [Our choices](#our-choices-where-the-sources-say-nothing)): the real directory content, the exact layout of SOAP faults, the format of `otherID` values in responses, case sensitivity of the search, and the format of `rolecode` in requests.

We never copy entries from the real directory or from the public [GDA search on gesundheit.gv.at](https://www.gesundheit.gv.at/gda.html). All mock entries are synthetic.

## Transport and access

- SOAP 1.2 over HTTPS, `Content-Type: application/soap+xml; charset=utf-8`, document/literal.
- Production `https://ehvdws.gesundheit.gv.at/`, quality assurance `https://ehvdwsint.gesundheit.gv.at/`. The WSDL is at `/ehvd.wsdl` on both.
- A web application firewall sits in front. Only registered source IP addresses get through. From an unregistered address, the TCP connection times out (tested on 29 October 2026).
- Access needs an application through the public health portal, signed with ID Austria, which describes the data needed, the purpose, and how the service will be called (§ 9 GTelV 2013). BRZ then opens the firewall for the source IP.
- Only healthcare providers and their processors may apply. The data may only be used to support the processing of health data (§ 9 Abs. 1 Z 1 GTelG 2012).

## Operations

The handbook and the WSDL use different names. The WSDL is what the service runs, so the mock and our client follow the WSDL.

| WSDL operation | Name in the handbook | Request element, wrapper | Response element | SOAP action |
|---|---|---|---|---|
| `GetGDA` | ID search, `GetGda` (v2.2: `GetGdaDescriptors`) | `GetGdaDescriptors` containing `hcIdentifier` (type `InstanceIdentifier`) | `GdaIndexResponse` with 0..1 `gda` | `eHVD/GetGDA` |
| `GdaSearch` | GDA search, `GdaSearch` (v2.2: `GetGdaSearch`) | `GetGdaSearch` containing `hcIdentifierSearch` (type `InstanceIdentifierSearch`) | `GdaIndexResponseList` with 0..n `gda` | `eHVD/GdaSearch` |

The target namespace is `eHVD`, with `elementFormDefault="qualified"`.

```xml
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:e="eHVD">
  <soap:Body>
    <e:GetGdaSearch>
      <e:hcIdentifierSearch>
        <e:firstname>Eva</e:firstname>
        <e:surname>Brandl</e:surname>
        <e:maxResults>10</e:maxResults>
        <e:ehvdstatus>Aktiv</e:ehvdstatus>
      </e:hcIdentifierSearch>
    </e:GetGdaSearch>
  </soap:Body>
</soap:Envelope>
```

### GetGDA: look up one entry by id

| Field | Type | Max length | Cardinality | Meaning |
|---|---|---|---|---|
| `oidIssuingAuthority` | string | 24 | 0..1 | Which kind of id `id` is. Omit it or send `1.2.40.0.34` for an eHVD OID. |
| `id` | string | 40 | 1..1 | The eHVD OID, or the number of the kind named in `oidIssuingAuthority` |

| Kind of id | `oidIssuingAuthority` |
|---|---|
| eHVD OID | omitted or `1.2.40.0.34` |
| Hospital number (KA-Nr) | `1.2.40.0.34.4.10` |
| Austrian Medical Chamber number (Arzt-Nr) | `1.2.40.0.34.4.18` |
| Outpatient clinic number (Ambu-Nr) | `1.2.40.0.34.4.20` |
| Contract partner number (VPNR) | `1.2.40.0.10.1.4.3.2` |
| Health professions register id (GBR-ID) | `1.2.40.0.34.4.23` |

A number without its `oidIssuingAuthority` is not unique. No hit returns fault 6002.

Undocumented: the MOA-ID module looks people up by their bPK for the health sector (`urn:publicid:gv.at:cdid+GH`) and uses `1.2.40.0.10.2.1.1.149` as `oidIssuingAuthority`. We read this from its compiled code, not from any document. The mock does not support it. A real bPK such as `QqRyJqno/aFVJYjMxkWpDJWj878=` contains `/`, `+`, or `=`. The `id` rule does not allow those characters, so the mock returns 6001. An `id` without them returns 6002, because `1.2.40.0.10.2.1.1.149` names no kind of id the mock knows.

### GdaSearch: search by name and other fields

Fields in WSDL order. The order matters for schema validation.

| Field | Type | Max length | Cardinality | Meaning |
|---|---|---|---|---|
| `firstname` | string | 128 | 0..1 | Given name, wildcard allowed |
| `surname` | string | 128 | 1..1 | Family name or organisation name, wildcard allowed |
| `rolecode` | string | | 0..1 | A GTelV role or an ELGA aggregate role |
| `postcode` | string | 10 | 0..1 | |
| `streetNumber` | string | 12 | 0..1 | |
| `streetName` | string | 88 | 0..1 | |
| `city` | string | 50 | 0..1 | |
| `state` | string | 20 | 0..1 | Federal state |
| `maxResults` | integer | 3 | 1..1 | 1 to 200 |
| `ehvdstatus` | string | | 0..1 | `Aktiv` returns only active entries, `Inaktiv` returns both |
| `elgastatus` | string | | 0..1 | Same for the ELGA status |
| `description` | string | 24 | 0..1 | Search in the additional information |

Rules from the handbook:

- Without `*`, the value must match the entry exactly.
- A wildcard search uses `*ABC`, `ABC*`, or `*ABC*`. Besides the `*`, the value must contain at least two letters A to Z or a to z. A bare `*` is not allowed.
- If there are more hits than `maxResults`, the service returns fault 6005 instead of a list. The service-wide limit is 200.

### Allowed characters in requests

| Field | Allowed |
|---|---|
| `oidIssuingAuthority` | digits and `.` |
| `id` | letters, digits, `.` and `-` |
| `surname`, `firstname`, `streetName`, `city`, `state` | Unicode letters (Latin), digits, blank, and `. - ~ _ + = /` |
| `streetNumber` | letters, digits, blank, and the same punctuation |
| `rolecode` | digits, `.` and letters |
| `postcode` | digits |
| `maxResults` | integer from 1 to 200 |
| `ehvdstatus`, `elgastatus` | `Aktiv` or `Inaktiv` |

## Response: GdaDescriptor

Fields in WSDL order. "Handbook" notes where the handbook differs.

| Field | Type | Cardinality | Meaning |
|---|---|---|---|
| `id` | `InstanceIdentifier` | 1..1 | `oidIssuingAuthority` (usually `1.2.40.0.34`) and the entry's OID |
| `otherID` | string | 0..n | Other public ids, such as a VPNR |
| `status` | `GDAStatus` | 1..1 | `ehvdstatus` and `elgastatus`, each `Aktiv` or `Inaktiv` |
| `firstname` | string | 0..1 | |
| `surname` | string | 1..1 | Family name, or the organisation's name |
| `gender` | string | 0..1 | Only in the WSDL |
| `title` | string | 0..1 | For example `Dr.` |
| `knownname` | string | 0..n | Other names, such as a short name |
| `address` | `GdaAddress` | 0..n | Practice addresses: `streetNumber`, `streetName`, `city`, `state`, `zip`, `country` (ISO 3166 alpha-2) |
| `description` | string | 1..n | Additional information, for example `Registrierungsstelle:Österreichische Ärztekammer` |
| `roles` | `GDARoles` | 1..1 | `role` (GTelV), `elgaRole` (ELGA aggregate role), `specialisation` (medical chamber), each 0..n, written `<code system OID>:<code>` |
| `relations` | `GDARelationship` | 0..1 | `memberof` and `ownerof`, each 0..n OIDs of other entries |
| `tel`, `fax`, `web`, `mail` | string | 0..1 each | `fax` only in the WSDL |
| `timestamps` | `GDADBTimestamps` | 1..1 | `add` and `modify`, `yyyy-MM-dd`. The WSDL makes `add` and `modify` optional. The handbook requires them. |

`ehvdstatus` `Aktiv` means the person or organisation may currently practise. `elgastatus` `Aktiv` means they may also use ELGA. `elgastatus` is `Inaktiv` whenever `ehvdstatus` is.

## Faults

The service returns errors as SOAP 1.2 faults with these codes and messages:

| Code | Message | When |
|---|---|---|
| 6001 | `Content is not valid!` (OidIssuingAuthority and/or Id is incorrect) | Malformed `oidIssuingAuthority` or `id`, or not enough search criteria |
| 6002 | `No compliance found!` | `GetGDA` finds nothing |
| 6003 | `A general error occurred!` | Any other error |
| 6004 | `Attribute not found!` | An expected attribute is missing in the directory entry |
| 6005 | `Maximum numbers of compliances exceeded!` | More hits than `maxResults` |
| 6006 | `User/Role is not allowed to use this webservice interface!` | The caller may not use this method |

## Code systems

All role values are written `<code system OID>:<code>`, for example `1.2.40.0.34.5.2:159`.

| Field | Code system | OID | Codes we use |
|---|---|---|---|
| `role` | ELGA_GTelVoGDARollen (roles under the health telematics regulation) | `1.2.40.0.34.5.2` | 100 general practitioner, 158 specialist physician (under the 2006 medical training regulation), 159 specialist physician (under the 2015 medical training regulation), 300 general hospital, 301 special hospital, 304 independent outpatient clinic |
| `elgaRole` | ELGA_GDA_Aggregatrollen (ELGA aggregate roles) | `1.2.40.0.34.5.3` | 700 physician, 702 hospital, 724 laboratory and pathology |
| `specialisation` | OEAEK_Fachrichtung (medical chamber specialties) | `1.2.40.0.34.3.1.10.20` | 7 internal medicine, 12 physical medicine and general rehabilitation, 19 medical and chemical laboratory diagnostics, 49 neurology |
| `specialisation` | OEAEK_Berechtigungen (medical chamber authorisations) | `1.2.40.0.34.3.1.10` | 0 general medicine |

In Austria, rehab clinics are special hospitals, and many labs are independent outpatient clinics. The code systems hold the official names in German.

## OIDs

The eHVD draws its ids from the node "eHealth-Austria", `1.2.40.0.34`:

| Node | Content |
|---|---|
| `1.2.40.0.34.3.1` | Organisations, assigned only by the eHVD |
| `1.2.40.0.34.3.2` | Natural persons, assigned only by the eHVD |
| `1.2.40.0.34.4` | Identification mechanisms, such as the KA-Nr (`.4.10`) |
| `1.2.40.0.34.5` | Code systems, such as the GTelV roles (`.5.2`) |

The official test entries sit under `1.2.40.0.34.3.1.0` and `1.2.40.0.34.3.2.0`, and ID Austria's test doctor under `1.2.40.0.34.3.2.99.0`. Our synthetic entries use `1.2.40.0.34.3.1.99.1` and `1.2.40.0.34.3.2.99.1`. They look real but are made up. Never use them outside this project.

## ID Austria sends the eHVD entry at login

ID Austria has an attribute "Gesundheitsdiensteanbieter":

- Claim name `urn:eidgvat:attributes.gda` in OpenID Connect and SAML2
- Value: UTF-8 JSON, Base64-encoded, with one object `gda` that has the GdaDescriptor fields `id`, `status`, `firstname`, `surname`, `title`, `address`, `description`, `roles`, and `timestamps`. It has no `relations`, so organisation membership needs a `GetGDA` call.
- Only when the person acts for themselves, not as a representative. Sent for ID Austria full and basic.
- Not documented: whether a private service provider like ours would receive it.

For a healthcare professional, this ties the login to the eHVD entry through the state, not only through the name. Keycloak simulates it, see [Identity and misdelivery](IDENTITY.md#realm-setup).

## Differences between the handbook and the WSDL

| Topic | Handbook v2.4 | WSDL version 2 |
|---|---|---|
| Operation names | GetGda, GdaSearch (v2.2: GetGdaDescriptors, GetGdaSearch) | `GetGDA`, `GdaSearch`, with request elements `GetGdaDescriptors` and `GetGdaSearch` |
| Request wrapper | not mentioned | `hcIdentifier`, `hcIdentifierSearch` |
| Position of `description` in the search | after `state` | last |
| `gender`, `fax` | missing | present |
| `timestamps.add`, `timestamps.modify` | required | optional |

## Our mock (T23)

### What it does

- A TypeScript service in its own container, `ehvd` in `docker-compose.yml`, on port 8095. The code is in `services/ehvd-mock/`, see [Code](#code).
- `GET /ehvd.wsdl` serves [`ehvd/eHVD.wsdl`](ehvd/eHVD.wsdl) byte for byte, except that the `soap12:address` location becomes `http://<Host header>/`, or `http://localhost:8095/` when the Host header is missing or empty. A SOAP client built from it then calls the mock.
- `POST /` takes SOAP 1.2 requests for `GetGDA` and `GdaSearch` exactly as in the WSDL. It finds the operation from the body element. An `action` parameter in the content type must name the same operation.
- It checks lengths, allowed characters, wildcard rules, and `maxResults`, applies the status filters, and returns the faults 6001 to 6006 as in the table above.
- An allowlist of client networks plays the BRZ firewall. Other clients get HTTP 403 with an empty body. Each allowlist entry can be limited to one operation, which triggers 6006 for the other.
- `GET /healthz` reports the number of entries, for `setup.sh` and Docker. It is the only path outside the allowlist.
- Each request other than `/healthz` writes one JSON line to the container log: client address, method, path, operation, number of hits, fault code, and HTTP status. The path is `/` or `/ehvd.wsdl`, and the log writes any other path as `other`. The log never holds search values.

### Configuration

The container reads two variables. Compose passes them from `.env` without defaults of its own. The mock treats an empty value as unset and uses the default below. ordy never reads them. An invalid value stops the container at startup with a message that names it. Apply a change with `docker compose up -d ehvd`.

| Variable | Default | Format |
|---|---|---|
| `EHVD_ALLOWLIST` | `127.0.0.0/8, ::1/128, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7` | Comma-separated networks in CIDR notation. A network followed by a blank and `GetGDA` or `GdaSearch` may use only that operation. The default is loopback and the private ranges, because Docker and colima forward requests from the host through a gateway such as `172.21.0.1`. |
| `EHVD_SCHEMA_ERRORS` | `http-403` | `http-403` answers a request that breaks SOAP 1.2 or the WSDL with an empty HTTP 403, like the real firewall. `fault-6001` answers it with fault 6001. |

Quote the allowlist in `.env`, because `setup.sh` reads the file with bash: `EHVD_ALLOWLIST="10.0.0.0/8, 172.16.0.0/12 GetGDA"`.

### Trigger each fault

| Code | How |
|---|---|
| 6001 | Break a field rule, for example `id` with a trailing blank, `surname` `*B`, `rolecode` `1.2.40.0.34.5.2:159`, or `maxResults` `201` |
| 6002 | `GetGDA` with an OID that is not in the directory, such as `1.2.40.0.34.3.2.99.9.1`, or with a well-formed `oidIssuingAuthority` that names no kind of id, such as `1.0.2` |
| 6003 | `GetGDA` with the reserved OID `1.2.40.0.34.3.1.99.9.6003` |
| 6004 | `GetGDA` with `1.2.40.0.34.3.1.99.9.6004`. That entry has no `timestamps`. `GdaSearch` never returns or counts it. |
| 6005 | `GdaSearch` with `surname` `Brandl` and `maxResults` `1`. There are two hits. |
| 6006 | Start the container with `EHVD_ALLOWLIST="0.0.0.0/0 GetGDA, ::/0 GetGDA"` and call `GdaSearch`. Every client may then use only `GetGDA`. |
| HTTP 403 | A client outside `EHVD_ALLOWLIST`, or a request that breaks SOAP 1.2 or the WSDL, such as `Content-Type: text/xml` or fields out of WSDL order |

### Our choices where the sources say nothing

| Question | Mock behaviour |
|---|---|
| Exact match: case-sensitive? | Case-insensitive, otherwise exact. This holds for the search fields and for the ids in `GetGDA`. |
| Unicode normalisation | The mock normalises request values to NFC before every check, so a decomposed `Ö` matches `Ö`. It does not trim them. |
| Which fields take a wildcard | `firstname`, `surname`, and `description`. A `*` anywhere else is 6001. |
| What a wildcard matches | `ABC*` a prefix, `*ABC` a suffix, `*ABC*` a substring, case-insensitive. `ABC` must not contain `*`. |
| `description` search | Matches when any `description` value of the entry matches. `:` is not allowed and the field is at most 24 characters long, so in practice it is a wildcard such as `*rztekammer`. |
| `firstname` on an entry without one | Never matches, so a `firstname` search finds no organisations |
| Address criteria | `postcode` (against `zip`), `streetNumber`, `streetName`, `city`, and `state` must all match the same address of the entry, exactly |
| `rolecode` format, given that `:` is not an allowed character | The bare code, for example `159` or `724`. It matches an entry with a `role` or an `elgaRole` of that code. GTelV and ELGA codes do not overlap. |
| An optional element without text | Counts as absent. An empty `id` or `surname` is 6001. |
| `maxResults` | An `xs:integer`, so a sign and surrounding whitespace pass the schema. Then it must have at most 3 characters and lie between 1 and 200. |
| Search without `ehvdstatus` | Returns active and inactive entries |
| Search without hits | Empty `GdaIndexResponseList`. Only `GetGDA` returns 6002. |
| 6004 in a search | Never. Only `GetGDA` reaches the entry without `timestamps`, so a wildcard search such as `*Test*` still returns its hits. |
| Order of results | Directory order |
| `oidIssuingAuthority` that is well-formed but names no kind of id | 6002, like an id without a hit. Well-formed means at least two arcs of digits, separated by `.`, without leading zeros. As in ITU-T X.660, the first arc is 0, 1, or 2, and after 0 or 1 the second arc is below 40. A malformed one, such as `1..2`, `3.1`, or `1.45`, is 6001. |
| bPK lookup | Not supported. A real bPK such as `QqRyJqno/aFVJYjMxkWpDJWj878=` contains `/`, `+`, or `=`, which the `id` rule rejects, so it returns 6001. With an `id` the rule allows, `1.2.40.0.10.2.1.1.149` is an unknown kind of id and returns 6002. |
| Fault layout | `soap:Code/soap:Value` is `soap:Sender` (HTTP 400) for 6001 and 6005, `soap:Receiver` (HTTP 500) otherwise. `soap:Reason/soap:Text` with `xml:lang="en"` carries the message from the table, without the text in brackets. `soap:Detail` holds one element, `<code xmlns="eHVD">6001</code>`. There is no `soap:Subcode`, because a bare `6001` is not a valid `xs:QName` and strict SOAP stacks reject it. |
| `otherID` format | `<id kind OID>:<number>`, for example `1.2.40.0.34.4.18:99002` |
| A request that breaks the schema | HTTP 403 with an empty body, as the third-party Python client `ehvd` reports for the real firewall. `EHVD_SCHEMA_ERRORS=fault-6001` switches it to fault 6001. A schema error is any of these: a `Content-Type` that Node's `MIMEType` cannot parse, another media type, an `action` of the other operation, a charset other than UTF-8, XML that is not well-formed with namespaces (such as a bare `&`, an unbound prefix, or two attributes with the same namespace and local name), a DOCTYPE, a character outside XML 1.0 (also as a character reference such as `&#0;` or `&#x110000;`), a body over 64 KiB, elements that do not follow the WSDL sequence, an attribute on an eHVD element other than a namespace declaration, or a header block that must be understood. A header block must be understood when `soap:mustUnderstand` is `true` or `1` and `soap:role` is absent, `…/role/next`, or `…/role/ultimateReceiver`. The mock understands no header block, so it answers such a request as a schema error, not with a `MustUnderstand` fault. It ignores all other header blocks. It parses every request as XML 1.0, even one that declares version 1.1. It ignores content type parameters other than `charset` and `action`, and a quoted parameter may contain `;`. `MIMEType` follows the WHATWG MIME rules, so it recovers some malformed parameters, such as a quote that is never closed. Over 64 KiB, the mock stops reading, answers, and closes the connection. A client that sends a body of a few MB may see a reset connection instead of that answer, because the mock closes the connection while the client is still sending. |
| Order of checks | Firewall, then schema, then 6006, then the field rules (6001), then the lookup |

### Directory content

All entries are synthetic. Each has `description` with its registration body and `timestamps`, except the 6004 entry below. Persons have the `description` `Registrierungsstelle:Österreichische Ärztekammer`, and organisations have `Registrierungsstelle:Amt der Landesregierung`. The handbook's group practice `1.2.40.0.34.3.1.0.5` is the one exception. It is a practice of doctors, so the mock gives it the medical chamber as its registration body. `GET /healthz` reports 313 entries.

| OID | Name | `role` / `elgaRole` | `specialisation` | `memberof` | `otherID` | Status | Address, `mail` |
|---|---|---|---|---|---|---|---|
| `1.2.40.0.34.3.1.99.1.1` | Klinikum Beispielstadt | 300 / 702 | | | KA-Nr `K9001` | Aktiv, Aktiv | Musterstraße 10, 1000 Beispielstadt, `office@klinikum.example` |
| `1.2.40.0.34.3.1.99.1.2` | Labor Kanalstraße | 304 / 724 | | | Ambu-Nr `A9101` | Aktiv, Aktiv | Kanalstraße 12, 1000 Beispielstadt, `office@labor-kanal.example` |
| `1.2.40.0.34.3.1.99.1.3` | Reha Waldblick | 301 / 702 | | | KA-Nr `K9301` | Aktiv, Aktiv | Waldweg 3, 1000 Beispielstadt, `office@reha-waldblick.example` |
| `1.2.40.0.34.3.2.99.1.1` | Dr. Lena Hofer | 159 / 700 | 10.20:7 | `…3.1.99.1.1` | Arzt-Nr `99001` | Aktiv, Aktiv | Klinikum address |
| `1.2.40.0.34.3.2.99.1.2` | Dr. Eva Brandl | 159 / 700 | 10.20:19 | `…3.1.99.1.2` | Arzt-Nr `99002` | Aktiv, Aktiv | Lab address |
| `1.2.40.0.34.3.2.99.1.3` | Dr. Johanna Leitner | 159 / 700 | 10.20:12 | `…3.1.99.1.3` | Arzt-Nr `99003` | Aktiv, Aktiv | Rehab clinic address |
| `1.2.40.0.34.3.2.99.1.4` | Dr. Martin Brandl | 100 / 700 | 10:0 | | Arzt-Nr `99004` | Aktiv, Aktiv | Linz. A different Brandl for name searches. |
| `1.2.40.0.34.3.2.99.1.5` | Dr. Eva Brandl-Huber | 159 / 700 | 10.20:19 | | Arzt-Nr `99005` | Inaktiv, Inaktiv | Graz. Tests the status filter and double names. |

Short forms: `10.20:19` is `1.2.40.0.34.3.1.10.20:19`, `10:0` is `1.2.40.0.34.3.1.10:0`, `…3.1.99.1.2` is `1.2.40.0.34.3.1.99.1.2`. Dr. Eva Brandl's descriptor matches the `urn:eidgvat:attributes.gda` claim of the Keycloak user `eva.brandl` on every field of the claim, and a test checks it. Her entry also has the lab address and `memberof`, which the claim does not carry.

Test entries, all Aktiv, Aktiv:

| OID | Name | `role` / `elgaRole` | `specialisation` | `otherID` | Address | Purpose |
|---|---|---|---|---|---|---|
| `1.2.40.0.34.3.1.0.2` | Test-GDA Ambulatorium | 304 / 702 | | Ambu-Nr `A9999` | Wien | Handbook test entry |
| `1.2.40.0.34.3.1.0.5` | Gruppenpraxis Dr. Aldemar SVC Betriebsordination Wahlarzt OG | 100 / 700 | 10:0 | | Wien and Graz | Handbook test entry. The two addresses test that address criteria match one address. |
| `1.2.40.0.34.3.2.0.10` | XXXeHealth Test-GDA XXXTest-GDA Support-Ordination BMG | 100 / 700 | 10:0 | | Scheingasse 1/3/3/40, 1010 Wien, the handbook's sample address | Handbook test entry |
| `1.2.40.0.34.3.2.99.0.11003` | Dr. XXXOtto XXXOttakringer | 158 and 100 / 700 | 10:0 and 10.20:49 | | none | ID Austria's test doctor, with the roles from the ID Austria example. Added and modified on 2022-09-10. |
| `1.2.40.0.34.3.1.99.9.6004` | ordy test entry without timestamps | 304 / 702 | | | none | Has no `timestamps`, so `GetGDA` on it returns fault 6004. `GdaSearch` never returns or counts it. |

The handbook's sample requests work against the mock. Apart from the OIDs, the names, and `A9999`, the handbook entries are made up. `1.2.40.0.34.3.1.99.9.6003` is reserved. It is not in the directory, and `GetGDA` on it returns 6003.

300 more entries come from a fixed-seed generator and are the same on every start. 249 are persons, with `role` 100 or 159, `elgaRole` 700, and an Arzt-Nr from `91000`. 83 of them are members of a generated organisation. 51 are organisations, with `role` 300, 301, or 304, a KA-Nr or Ambu-Nr, and `mail` on an `.example` domain. A generated person has the OID `1.2.40.0.34.3.2.99.1.<n>`, and a generated organisation has `1.2.40.0.34.3.1.99.1.<n>`, where each n from 1000 to 1299 appears once. They cover all nine federal states with fictional streets. 36 are inactive, and 13 more are active without ELGA. The generator never uses the surnames Brandl, Hofer, Leitner, Huber, Wagner, Kern, Beispiel, or Ottakringer. It never adds a member to the three scenario organisations. Both rules keep the results of the scenario's searches exact. The generated entries make wildcard searches, the status filter, and fault 6005 behave like the real thing.

Not in the directory: Stefan Kern and Karl Heinz Moser-Wallner (discharge management staff are not healthcare professionals), Sophie Lindner-Pichler (a biomedical scientist who sends results Dr. Eva Brandl validated), Thomas Wagner, Anna Huber, and the second Eva Brandl.

### Code

| Path in `services/ehvd-mock/` | Content |
|---|---|
| `src/soap.ts` | The wire format from the WSDL: the request sequences, the operation table, a strict XML parser on [saxes](https://github.com/lddubeau/saxes), envelope parsing, responses, and the fault registry |
| `src/rules.ts` | The field rules: lengths, allowed characters with a table of the Latin letters in Unicode, and wildcards |
| `src/query.ts` | `GetGDA` and `GdaSearch` over the directory, and the conversion to `GdaDescriptor` that raises 6004 |
| `src/directory.ts`, `src/generated.ts`, `src/codes.ts` | The fixed entries, the generator, and the id kinds and registration bodies that both use |
| `src/server.ts`, `src/config.ts`, `src/main.ts` | HTTP, the allowlist, the WSDL, the log, and the two variables |
| `test/` | The tests that `pnpm test` runs |
| `Dockerfile` | `node:24-alpine`, built from the repository root, with only the mock's production dependencies from the lockfile |

Node runs the TypeScript files directly with type stripping, so the service has no build step. Its own `tsconfig.json` allows only erasable syntax, and `pnpm typecheck` checks it. To run it without Docker, on Node.js 22.18 or newer: `pnpm --filter ehvd-mock start`.

The tests start the server on a free port and send real SOAP over HTTP. They cover the handbook's sample requests, every fault from 6001 to 6006 and both kinds of HTTP 403, the wildcard, status, and address rules, and the served WSDL. A node-soap client built from the served WSDL calls both operations and receives a fault. One test compares Eva Brandl's entry with her Keycloak claim, and one compares the request tables with [`ehvd/eHVD.wsdl`](ehvd/eHVD.wsdl).

## How ordy uses the eHVD (T15)

The code lives in `src/server/ehvd/` and reads `EHVD_URL`, default `http://localhost:8095/`.

| Check | How |
|---|---|
| Organisation | `GdaSearch` with the organisation name as `surname`, `ehvdstatus` `Aktiv`, and `maxResults` 10. Exactly one active organisation whose name has the same words gives the OID and the `mail` domain. Persons with that surname do not count. |
| Address check before sending | The domain of the email address Dr. Hofer typed must equal the domain of the organisation's `mail`. `labor-kanaI.example` does not. |
| Responsible person, when it is the sender and the login carried the GDA claim | `GetGDA` with the OID from the claim. The entry must have that OID, be a person, carry the name from the document, be active, have the role the document type needs, and list the organisation in `memberof`. |
| Responsible person, otherwise | `GdaSearch` with the `surname` from the document and `maxResults` 200, without a status filter, so the notice can say that a physician is not active. Only if that gives fault 6005 does a second search add the `firstname`. Exactly one active hit that carries the name from the document and is a member of the organisation confirms the role. Here the name is the only link. |
| Lab result | The physician under `Validated by`: `role` 158 or 159 with `specialisation` `1.2.40.0.34.3.1.10.20:19`, member of the lab |
| Rehab report | The physician under `Written by`: `elgaRole` 700, member of the rehab clinic. The rehab clinic: active, `role` 300 or 301. The sender is usually not listed. |

These are the release check from [Identity and misdelivery](IDENTITY.md#who-may-release-a-document). If the eHVD cannot be reached or returns 6003, the result is a hold, never a pass. FHIR Practitioner and Organization resources carry the eHVD OID as identifier, see [FHIR model](FHIR.md#practitioner-and-organization).

### The client

`client.ts` sends SOAP 1.2 with `fetch`: the operation's action in the content type, the fields in WSDL order (`soap.ts`), and every value escaped. `xml.ts` reads the answer with saxes, namespace-aware. It refuses any DOCTYPE and any nesting deeper than 32 levels, because saxes resolves namespaces by walking the open elements and a deeply nested answer would block the server for minutes. `ehvd` is the client for `EHVD_URL`. Tests build their own with `createEhvdClient({ url, timeoutMs })`.

`getGda` and `gdaSearch` return `{ ok: true, value }` or `{ ok: false, failure }`. They never throw.

| `failure.kind` | When |
|---|---|
| `unreachable` | No connection, no answer within 5 seconds, a redirect, or an HTTP status other than 200, 400, and 500. The firewall's empty 403 is one. |
| `fault` | A SOAP fault, with the fault's `message` and `code` 6001 to 6006. The code comes from `soap:Detail`, where the mock puts it, else from the message in the fault table, since the real layout is not public. Null if neither gives one. |
| `bad_response` | An answer that is not the SOAP the WSDL describes, larger than 4 MiB, or not UTF-8. This includes an HTTP 400 or 500 without a fault, and any element other than an `eHVD` `gda` in the response, so an unexpected layout never reads as fewer hits. |
| `bad_request` | ordy refused to send the value: a character the field rules do not allow, too long, a blank at the start or end, or `maxResults` outside 1 to 200. `*` counts as not allowed, so ordy never searches with a wildcard. `field` names the field. |

`GetGDA` without a hit, fault 6002, is `{ ok: true, value: null }`, not a failure. A caller of the identity checks at login (T08) passes `unreachable: ["ehvd"]` for any failure.

### The address check

`checkAddress({ channel, address, org })` in `address-check.ts` returns one of three results:

| Result | When | What the request service does |
|---|---|---|
| `pass` | The domain matches, compared case-insensitively and without a trailing dot. An SMS always passes: the person's mobile number cannot be compared with the organisation's `tel`. | Sends |
| `mismatch`, with `domain` and `expectedDomain` | The domain differs | `awaiting_confirmation` with **Send anyway** and **Cancel**, and `misdelivery_caught` with `address_mismatch` |
| `unchecked`, with a reason | The eHVD cannot confirm the address: `organisation_not_listed`, `several_organisations`, `no_mail`, `not_searchable`, or `ehvd_unreachable`. Or the address is not one plain address with an ASCII domain (`invalid_address`): several `@`, a list, a space, or a domain with the Kelvin sign U+212A in place of the `K`, which would lowercase to the organisation's `k`. The request form refuses those already. | `awaiting_confirmation` too, because an unchecked address is never a pass, but no `misdelivery_caught`: nothing was caught |

`addressWarning(check, org)` gives the widget text, for example "The address domain labor-kanaI.example does not match Labor Kanalstraße (labor-kanal.example)." or "The eHVD could not be reached, so the address could not be checked."

### The release check

`checkRelease({ document, org, sender })` in `release-check.ts` runs after the patient check. `org` is the organisation the request went to, and `sender` the ID Austria login of the person who answered, with `gdaOid` from the GDA claim or null. It returns `pass`, with `via` `claim` or `search`, the practitioner's entry, and the organisation's entry, or `hold`, with a `reason` code and a `sentence` for Dr. Hofer's notice. A hold about the organisation names the organisation. It never blocks. The answer flow (T13) maps a pass to `answer_confirmed` and a hold to `answer_unconfirmed`.

The names follow the [name match](IDENTITY.md#name-match): every word of the document's given name and family name must be in the entry's. The search hits are compared that way too, so the decision never rests on how the eHVD matches names. A name without words in its given or family name never passes, because an empty set passes every subset test.

| Reason | When | Sentence, for example |
|---|---|---|
| `no_responsible_person` | The document names nobody under `Validated by` or `Written by` | The document names nobody under Validated by. |
| `incomplete_name` | The responsible person's given or family name has no words, such as `Dr. Brandl` | The document does not give the full name of Dr. Brandl. |
| `organisation_differs` | The heading names another organisation than the request went to | The document comes from Reha Waldblick, but the request went to Labor Kanalstraße. |
| `organisation_not_listed`, `several_organisations` | The organisation search finds no active organisation, or more than one | The eHVD does not list Labor Nirgendwo as an active organisation. |
| `organisation_not_hospital` | A rehab report from an organisation without `role` 300 or 301 | The eHVD does not list Labor Kanalstraße as a hospital. |
| `not_listed` | No active person with that name, or the claim's OID has no person entry | The eHVD does not list Dr. Anna Huber. |
| `claim_differs` | The entry for the OID in the sender's login carries another name than the document, or another OID | The eHVD entry of the sender's ID Austria login is not Dr. Eva Brandl. |
| `not_active`, `wrong_role`, `not_member` | The entry is inactive, lacks the role the document type needs, or is not a member of the organisation. The name search finds members first, then checks that one is active. | The eHVD does not list Dr. Martin Brandl as a member of Labor Kanalstraße. |
| `several_matches` | More than one active member with that name, or fault 6005 | The eHVD lists more than one Dr. Eva Brandl at Labor Kanalstraße. |
| `not_searchable` | The name or organisation breaks the field rules, such as `O'Brandl` | The eHVD cannot be searched for Dr. Eva O'Brandl. |
| `ehvd_unreachable` | Any other failure, also 6003 | The eHVD could not be reached to confirm Dr. Eva Brandl. Or, when the organisation search fails: … to confirm Labor Kanalstraße. |

### Tests

`src/server/ehvd/*.test.ts` run against the T23 mock, started in the test process by `start-mock.ts`, so `pnpm test` needs no container. They cover the WSDL field order, the faults 6002 to 6006, the firewall's 403, a closed port, a timeout, a redirect, answers the WSDL does not describe, the field rules, scenario requests 1 and 2, M1's address, and the release check for the five filed documents in [`track/scenario/extra/`](../track/scenario/extra/index.md). Cases the mock never produces, such as two physicians with the same name at one lab, use a client that changes the mock's answers.
