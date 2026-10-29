import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";

import { allows, clientAddress, type Config } from "./config.ts";
import { directory } from "./directory.ts";
import { gdaSearch, getGda, type Answer } from "./query.ts";
import { readGetGda, readSearch } from "./rules.ts";
import { escapeXml, faults, faultXml, parseRequest, responseXml, type FaultCode, type Operation, type SoapRequest } from "./soap.ts";

const MAX_BODY_BYTES = 64 * 1024;
const REAL_LOCATION = Buffer.from('location="https://ehvdws.gesundheit.gv.at"');
const SOAP_TYPE = "application/soap+xml; charset=utf-8";
const LOGGED_PATHS = new Set(["/", "/ehvd.wsdl"]);

function loadWsdl() {
  const wsdl = readFileSync(new URL("../../../docs/ehvd/eHVD.wsdl", import.meta.url));
  const at = wsdl.indexOf(REAL_LOCATION);
  if (at === -1 || wsdl.indexOf(REAL_LOCATION, at + 1) !== -1) {
    throw new Error(`docs/ehvd/eHVD.wsdl must contain ${REAL_LOCATION} exactly once`);
  }
  return (host: string | undefined) =>
    Buffer.concat([wsdl.subarray(0, at), Buffer.from(`location="${escapeXml(`http://${host ?? "localhost:8095"}/`)}"`), wsdl.subarray(at + REAL_LOCATION.length)]);
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function run(request: SoapRequest): Answer | undefined {
  if (request.operation === "GetGDA") {
    const query = readGetGda(request.fields);
    return query && getGda(directory, query);
  }
  const query = readSearch(request.fields);
  return query && gdaSearch(directory, query);
}

type Reply = {
  status: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
  operation?: Operation;
  hits?: number;
  fault?: FaultCode;
};

const faultReply = (fault: FaultCode, details: Omit<Reply, "status"> = {}): Reply => ({
  ...details,
  status: faults[fault].soapCode === "Sender" ? 400 : 500,
  headers: { "content-type": SOAP_TYPE },
  body: faultXml(fault),
  fault,
});

export function createEhvdServer(config: Config, log: (line: string) => void = console.log) {
  const wsdlFor = loadWsdl();
  const reachable = (client: string | undefined) => allows(config.allowlist.GetGDA, client) || allows(config.allowlist.GdaSearch, client);
  const schemaError = (): Reply => (config.schemaErrors === "fault-6001" ? faultReply(6001) : { status: 403 });

  async function handle(req: IncomingMessage, path: string, client: string | undefined): Promise<Reply> {
    if (!reachable(client)) return { status: 403 };
    if (path === "/ehvd.wsdl") {
      if (req.method !== "GET") return { status: 405, headers: { allow: "GET" } };
      return { status: 200, headers: { "content-type": "text/xml; charset=utf-8" }, body: wsdlFor(req.headers.host) };
    }
    if (path !== "/") return { status: 404 };
    if (req.method !== "POST") return { status: 405, headers: { allow: "POST" } };

    const body = await readBody(req);
    if (body === undefined) {
      const reply = schemaError();
      return { ...reply, headers: { ...reply.headers, connection: "close" } };
    }
    const request = parseRequest(req.headers["content-type"], body);
    if (!request) return schemaError();
    const { operation } = request;
    if (!allows(config.allowlist[operation], client)) return faultReply(6006, { operation });
    const answer = run(request);
    if (!answer) return faultReply(6001, { operation });
    if ("fault" in answer) return faultReply(answer.fault, { operation, hits: answer.hits });
    return { status: 200, headers: { "content-type": SOAP_TYPE }, body: responseXml(operation, answer.gdas), operation, hits: answer.hits };
  }

  return createServer(async (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ok", entries: directory.length }));
      return;
    }
    const client = clientAddress(req.socket.remoteAddress);
    let reply: Reply;
    // Reading the body rejects when a client disconnects mid-request, and an unhandled rejection would stop the server.
    try {
      reply = await handle(req, path, client);
    } catch (error) {
      console.error(error);
      reply = path === "/" ? faultReply(6003) : { status: 500 };
    }
    const { status, headers, body, operation, hits, fault } = reply;
    res.writeHead(status, headers).end(body);
    log(JSON.stringify({ client, method: req.method, path: LOGGED_PATHS.has(path) ? path : "other", operation, hits, fault, status }));
  });
}
