import { BlockList, isIP, isIPv4 } from "node:net";

import { operations, type Operation } from "./soap.ts";

const DEFAULT_ALLOWLIST = "127.0.0.0/8, ::1/128, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7";

type Allowlist = Record<Operation, BlockList>;

export type Config = { allowlist: Allowlist; schemaErrors: "http-403" | "fault-6001" };

const isOperation = (name: string): name is Operation => Object.hasOwn(operations, name);

function addNetwork(lists: BlockList[], cidr: string) {
  const [address, prefix, ...rest] = cidr.split("/");
  const family = isIP(address);
  const bits = family === 4 ? 32 : 128;
  const isPrefix = prefix !== undefined && prefix !== "" && [...prefix].every((char) => char >= "0" && char <= "9");
  if (family === 0 || rest.length > 0 || !isPrefix || Number(prefix) > bits) {
    throw new Error(`EHVD_ALLOWLIST: "${cidr}" is not a network in CIDR notation, such as 10.0.0.0/8 or fc00::/7`);
  }
  for (const list of lists) list.addSubnet(address, Number(prefix), family === 4 ? "ipv4" : "ipv6");
}

function parseAllowlist(text: string): Allowlist {
  const allowlist: Allowlist = { GetGDA: new BlockList(), GdaSearch: new BlockList() };
  for (const entry of text.split(",")) {
    const [cidr, operation, ...rest] = entry.split(" ").filter((part) => part !== "");
    if (cidr === undefined || rest.length > 0 || (operation !== undefined && !isOperation(operation))) {
      throw new Error(`EHVD_ALLOWLIST: "${entry.trim()}" must be a network, optionally followed by GetGDA or GdaSearch`);
    }
    addNetwork(operation === undefined ? Object.values(allowlist) : [allowlist[operation]], cidr);
  }
  return allowlist;
}

export function parseConfig(env: Record<string, string | undefined>): Config {
  const schemaErrors = env.EHVD_SCHEMA_ERRORS ?? "http-403";
  if (schemaErrors !== "http-403" && schemaErrors !== "fault-6001") {
    throw new Error(`EHVD_SCHEMA_ERRORS must be http-403 or fault-6001, not "${schemaErrors}"`);
  }
  return { allowlist: parseAllowlist(env.EHVD_ALLOWLIST ?? DEFAULT_ALLOWLIST), schemaErrors };
}

// Node reports IPv4 clients of a dual-stack socket as ::ffff:a.b.c.d.
export function clientAddress(remote: string | undefined) {
  const mapped = remote?.startsWith("::ffff:") ? remote.slice("::ffff:".length) : undefined;
  return mapped !== undefined && isIPv4(mapped) ? mapped : remote;
}

export function allows(list: BlockList, address: string | undefined) {
  if (address === undefined) return false;
  const family = isIP(address);
  return family !== 0 && list.check(address, family === 4 ? "ipv4" : "ipv6");
}
