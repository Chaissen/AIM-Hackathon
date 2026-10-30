import { once } from "node:events";

import { parseConfig } from "../src/config.ts";
import { createEhvdServer } from "../src/server.ts";
import { children, descendants, parse, text } from "./xml.ts";

export async function start(env: Record<string, string> = {}, host = "127.0.0.1") {
  const logs: string[] = [];
  const server = createEhvdServer(parseConfig(env), (line) => logs.push(line));
  await once(server.listen(0, host), "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server is not listening on a port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    logs,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export const envelope = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:e="eHVD"><soap:Body>${body}</soap:Body></soap:Envelope>`;

const elements = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([name, value]) => `<e:${name}>${value}</e:${name}>`)
    .join("");

export const getGdaXml = (fields: Record<string, string>) =>
  envelope(`<e:GetGdaDescriptors><e:hcIdentifier>${elements(fields)}</e:hcIdentifier></e:GetGdaDescriptors>`);

export const searchXml = (fields: Record<string, string>) =>
  envelope(`<e:GetGdaSearch><e:hcIdentifierSearch>${elements(fields)}</e:hcIdentifierSearch></e:GetGdaSearch>`);

export async function post(url: string, xml: string, contentType = "application/soap+xml; charset=utf-8") {
  const response = await fetch(`${url}/`, { method: "POST", headers: { "content-type": contentType }, body: xml });
  return { status: response.status, body: await response.text() };
}

export const oids = (xml: string) =>
  descendants(parse(xml), "eHVD", "gda").map((gda) =>
    children(gda, "eHVD", "id")
      .flatMap((id) => children(id, "eHVD", "id").map(text))
      .join(),
  );

export const faultEnvelope = (soapCode: "Sender" | "Receiver", message: string, code: number) =>
  `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><soap:Fault>` +
  `<soap:Code><soap:Value>soap:${soapCode}</soap:Value></soap:Code><soap:Reason><soap:Text xml:lang="en">${message}</soap:Text></soap:Reason>` +
  `<soap:Detail><code xmlns="eHVD">${code}</code></soap:Detail></soap:Fault></soap:Body></soap:Envelope>`;
