# eHVD: the real interface and our mock

The eHealth directory (eHVD, eHealth Verzeichnisdienst) lists every person and organisation in Austria that works as a healthcare provider (GDA, Gesundheitsdiensteanbieter). Registration bodies such as the medical chamber keep it current. ordy uses it to confirm roles, such as "active lab physician at Labor Kanalstraße", and to check email domains before sending.

The real web service needs a registration with the health ministry and an IP allowlist entry at BRZ, so we cannot call it during the hackathon. We build a mock that behaves like the real service in every documented way. This page records what is public about the interface, which gaps we fill and how, and what the mock contains.

Status: the mock is planned as T23, the client in ordy as T15. See [Timeline](TIMELINE.md).

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

Undocumented: the MOA-ID module looks people up by their bPK for the health sector (`urn:publicid:gv.at:cdid+GH`) and uses `1.2.40.0.10.2.1.1.149` as `oidIssuingAuthority`. We read this from its compiled code, not from any document. The mock supports it only behind a switch that is off by default.

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
- A wildcard search uses `*ABC`, `ABC*`, or `*ABC*`, with at least two letters A to Z or a to z next to the `*`. A bare `*` is not allowed.
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
| `timestamps` | `GDADBTimestamps` | 1..1 | `add` and `modify`, `yyyy-MM-dd`. Optional in the WSDL, required in the handbook. |

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
| `role` | ELGA_GTelVoGDARollen (roles under the health telematics regulation) | `1.2.40.0.34.5.2` | 100 general practitioner, 159 specialist physician (under the 2015 medical training regulation), 300 general hospital, 301 special hospital, 304 independent outpatient clinic |
| `elgaRole` | ELGA_GDA_Aggregatrollen (ELGA aggregate roles) | `1.2.40.0.34.5.3` | 700 physician, 702 hospital, 724 laboratory and pathology |
| `specialisation` | OEAEK_Fachrichtung (medical chamber specialties) | `1.2.40.0.34.3.1.10.20` | 7 internal medicine, 12 physical medicine and general rehabilitation, 19 medical and chemical laboratory diagnostics |
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

- A TypeScript service in its own container, `ehvd` in `docker-compose.yml`, on port 8095.
- `GET /ehvd.wsdl` serves [`ehvd/eHVD.wsdl`](ehvd/eHVD.wsdl) unchanged, except that `soap12:address` points to the mock.
- `POST /` takes SOAP 1.2 requests for `GetGDA` and `GdaSearch` exactly as in the WSDL. It finds the operation from the body element and accepts the SOAP action in the `action` parameter of the content type.
- It checks lengths, allowed characters, wildcard rules, and `maxResults`, applies the status filters, and returns the faults 6001 to 6006 as in the table above.
- An allowlist of client networks plays the BRZ firewall. Other clients get HTTP 403. Each allowlist entry can be limited to one operation, which triggers 6006 for the other.
- `GET /healthz` for `setup.sh` and Docker.
- The log holds the operation, the client, the number of hits, and the fault code.

### Our choices where the sources say nothing

| Question | Mock behaviour |
|---|---|
| Exact match: case-sensitive? | Case-insensitive, otherwise exact |
| `rolecode` format, given that `:` is not an allowed character | The bare code, for example `159` or `724`. GTelV and ELGA codes do not overlap. |
| Search without `ehvdstatus` | Returns active and inactive entries |
| Search without hits | Empty `GdaIndexResponseList`. Only `GetGDA` returns 6002. |
| Fault layout | `soap:Code/soap:Value` is `soap:Sender` for 6001 and 6005, `soap:Receiver` otherwise. `soap:Subcode/soap:Value` and `soap:Detail` carry the number, `soap:Reason/soap:Text` the message from the table. |
| `otherID` format | `<id kind OID>:<number>`, for example `1.2.40.0.34.4.18:99002` |
| A request that breaks the schema | HTTP 403, as the third-party Python client `ehvd` reports for the real firewall. Can be switched to fault 6001. |
| bPK lookup | Off by default |

### Directory content

All entries are synthetic. Each has `description` with its registration body and `timestamps`.

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

Short forms: `10.20:19` is `1.2.40.0.34.3.1.10.20:19`, `10:0` is `1.2.40.0.34.3.1.10:0`, `…3.1.99.1.2` is `1.2.40.0.34.3.1.99.1.2`. Dr. Eva Brandl's descriptor matches the `urn:eidgvat:attributes.gda` claim of the Keycloak user `eva.brandl` field for field.

Also in the mock:

- The three test entries from the handbook with their documented OIDs and names: "Test-GDA Ambulatorium" (`1.2.40.0.34.3.1.0.2`, Ambu-Nr `A9999`), "Gruppenpraxis Dr. Aldemar SVC Betriebsordination Wahlarzt OG" (`1.2.40.0.34.3.1.0.5`), and "XXXeHealth Test-GDA XXXTest-GDA Support-Ordination BMG" (`1.2.40.0.34.3.2.0.10`). The handbook's sample requests then work against the mock. Their other fields are made up.
- ID Austria's test doctor "Dr. XXXOtto XXXOttakringer" (`1.2.40.0.34.3.2.99.0.11003`) with the roles from the ID Austria example.
- About 300 generated entries from a fixed seed: a realistic mix of roles and federal states, about 10 percent inactive, fictional streets. They make wildcard searches, the status filter, and fault 6005 behave like the real thing.

Not in the directory: Stefan Kern and Karl Heinz Moser-Wallner (discharge management staff are not healthcare professionals), Sophie Lindner-Pichler (a biomedical scientist who sends results Dr. Eva Brandl validated), Thomas Wagner, Anna Huber, and the second Eva Brandl.

### Done when

- The handbook's sample requests return the test entries.
- Every fault code from 6001 to 6006 and the HTTP 403 can be triggered.
- A SOAP client generated from [`ehvd/eHVD.wsdl`](ehvd/eHVD.wsdl) works against the mock without changes.
- `docker compose up` starts the container, and `./scripts/setup.sh` waits for `/healthz`.

## How ordy uses the eHVD (T15)

The client lives in `src/server/ehvd/` and reads `EHVD_URL`, default `http://localhost:8095/`.

| Check | How |
|---|---|
| Organisation | `GdaSearch` with the organisation name as `surname` and `ehvdstatus` `Aktiv`. One hit gives the organisation's OID and its `mail` domain. |
| Address check before sending | The domain of the email address Dr. Hofer typed must equal the domain of the organisation's `mail`. `labor-kanaI.example` does not. |
| Responsible person, when it is the sender and the login carried the GDA claim | `GetGDA` with the OID from the claim. The entry must be active, have the role the document type needs, and list the organisation in `memberof`. |
| Responsible person, otherwise | `GdaSearch` with `firstname` and `surname` from the document and `ehvdstatus` `Aktiv`. Exactly one hit that is a member of the organisation confirms the role. Here the name is the only link. |
| Lab result | The physician under `Validated by`: `role` 158 or 159 with `specialisation` `1.2.40.0.34.3.1.10.20:19`, member of the lab |
| Rehab report | The physician under `Written by`: `elgaRole` 700, member of the rehab clinic. The rehab clinic: active, `role` 300 or 301. The sender is usually not listed. |

These are the release check from [Identity and misdelivery](IDENTITY.md#who-may-release-a-document). If the eHVD cannot be reached or returns 6003, the result is a hold, never a pass. FHIR Practitioner and Organization resources carry the eHVD OID as identifier, see [FHIR model](FHIR.md#practitioner-and-organization).
