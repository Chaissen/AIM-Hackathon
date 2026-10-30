import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";

import { createClientAsync } from "soap";

import { start } from "./http.ts";

const mock = await start();
after(mock.close);
const client = await createClientAsync(`${mock.url}/ehvd.wsdl`, { forceSoap12Headers: true });

test("a node-soap client built from the served WSDL calls GetGDA and GdaSearch", async () => {
  const [byOid] = await client.GetGDAAsync({ hcIdentifier: { oidIssuingAuthority: "1.2.40.0.34", id: "1.2.40.0.34.3.2.99.1.2" } });
  assert.deepEqual(byOid.gda, {
    id: { oidIssuingAuthority: "1.2.40.0.34", id: "1.2.40.0.34.3.2.99.1.2" },
    otherID: ["1.2.40.0.34.4.18:99002"],
    status: { ehvdstatus: "Aktiv", elgastatus: "Aktiv" },
    firstname: "Eva",
    surname: "Brandl",
    title: "Dr.",
    address: [{ streetNumber: "12", streetName: "Kanalstraße", city: "Beispielstadt", zip: "1000", country: "AT" }],
    description: ["Registrierungsstelle:Österreichische Ärztekammer"],
    roles: { role: ["1.2.40.0.34.5.2:159"], elgaRole: ["1.2.40.0.34.5.3:700"], specialisation: ["1.2.40.0.34.3.1.10.20:19"] },
    relations: { memberof: ["1.2.40.0.34.3.1.99.1.2"] },
    timestamps: { add: "2019-03-01", modify: "2026-01-15" },
  });

  const [list] = await client.GdaSearchAsync({ hcIdentifierSearch: { surname: "Brandl*", maxResults: 10, ehvdstatus: "Aktiv" } });
  assert.deepEqual(
    list.gda.map((gda: { id: { id: string }; firstname: string; surname: string }) => [gda.id.id, gda.firstname, gda.surname]),
    [
      ["1.2.40.0.34.3.2.99.1.2", "Eva", "Brandl"],
      ["1.2.40.0.34.3.2.99.1.4", "Martin", "Brandl"],
    ],
  );
});

test("a fault reaches the node-soap client with its eHVD code", async () => {
  await assert.rejects(client.GdaSearchAsync({ hcIdentifierSearch: { surname: "Brandl", maxResults: 1 } }), (error: { root: unknown }) => {
    assert.deepEqual(error.root, {
      Envelope: {
        Body: {
          Fault: {
            Code: { Value: "soap:Sender" },
            Reason: { Text: { attributes: { "xml:lang": "en" }, $value: "Maximum numbers of compliances exceeded!" } },
            Detail: { code: "6005" },
          },
        },
      },
    });
    return true;
  });
});

test("Eva Brandl's descriptor equals her ID Austria GDA claim in Keycloak on every field of the claim", async () => {
  const realm = JSON.parse(readFileSync(new URL("../../../docker/keycloak/idaustria-sim-realm.json", import.meta.url), "utf8"));
  const user = realm.users.find((candidate: { username: string }) => candidate.username === "eva.brandl");
  const claim = JSON.parse(Buffer.from(user.attributes.gda[0], "base64").toString("utf8")).gda;
  assert.deepEqual(Object.keys(claim), ["id", "status", "firstname", "surname", "title", "description", "roles", "timestamps"]);

  const [response] = await client.GetGDAAsync({ hcIdentifier: { oidIssuingAuthority: claim.id.oidIssuingAuthority, id: claim.id.id } });
  for (const field of Object.keys(claim)) assert.deepEqual(response.gda[field], claim[field], field);
});
