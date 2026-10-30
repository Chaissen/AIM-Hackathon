import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { operations, type XmlElement } from "../src/soap.ts";
import { attribute, children, descendants, parse, selfAndDescendants } from "./xml.ts";

const XS = "http://www.w3.org/2001/XMLSchema";
const WSDL = "http://schemas.xmlsoap.org/wsdl/";
const SOAP12 = "http://schemas.xmlsoap.org/wsdl/soap12/";

const wsdl = parse(readFileSync(new URL("../../../docs/ehvd/eHVD.wsdl", import.meta.url), "utf8"));

const named = (namespace: string, localName: string, name: string, parent: string) => {
  const found = selfAndDescendants(wsdl)
    .filter((element) => element.localName === parent)
    .flatMap((element) => children(element, namespace, localName))
    .find((element) => attribute(element, "name") === name);
  assert.ok(found, `${localName} ${name} in ${parent}`);
  return found;
};

const sequence = (complexType: XmlElement) =>
  descendants(complexType, XS, "element").map((element) => ({
    name: attribute(element, "name"),
    type: attribute(element, "type"),
    minOccurs: Number(attribute(element, "minOccurs")),
    maxOccurs: Number(attribute(element, "maxOccurs")),
  }));

const messageElement = (operation: XmlElement, direction: "input" | "output") =>
  attribute(
    descendants(
      named(WSDL, "message", (attribute(descendants(operation, WSDL, direction)[0], "message") ?? "").slice("tns:".length), "definitions"),
      WSDL,
      "part",
    )[0],
    "element",
  );

test("the request tables equal the WSDL's operations and their InstanceIdentifier sequences", () => {
  for (const [name, operation] of Object.entries(operations)) {
    const portTypeOperation = named(WSDL, "operation", name, "portType");
    const request = sequence(named(XS, "element", operation.element, "schema"));
    assert.deepEqual(
      {
        soapAction: attribute(descendants(named(WSDL, "operation", name, "binding"), SOAP12, "operation")[0], "soapAction"),
        element: messageElement(portTypeOperation, "input"),
        wrapper: request,
        response: messageElement(portTypeOperation, "output"),
        sequence: sequence(named(XS, "complexType", operation.wrapperType, "schema")),
      },
      {
        soapAction: operation.soapAction,
        element: `tns:${operation.element}`,
        wrapper: [{ name: operation.wrapper, type: `ehvd:${operation.wrapperType}`, minOccurs: 1, maxOccurs: 1 }],
        response: `tns:${operation.response}`,
        sequence: operation.sequence,
      },
      name,
    );
  }
});
