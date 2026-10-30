import assert from "node:assert/strict";

import { parseXml, type XmlElement } from "../src/soap.ts";

export function parse(xml: string) {
  const root = parseXml(xml);
  assert.ok(root, `not well-formed XML: ${xml}`);
  return root;
}

const elements = (element: XmlElement) => element.children.filter((child) => typeof child !== "string");
const is = (element: XmlElement, namespace: string, localName: string) => element.namespace === namespace && element.localName === localName;

export const selfAndDescendants = (element: XmlElement): XmlElement[] => [element, ...elements(element).flatMap(selfAndDescendants)];

export const children = (element: XmlElement, namespace: string, localName: string) =>
  elements(element).filter((child) => is(child, namespace, localName));

export const descendants = (element: XmlElement, namespace: string, localName: string) =>
  elements(element)
    .flatMap(selfAndDescendants)
    .filter((descendant) => is(descendant, namespace, localName));

export const attribute = (element: XmlElement | undefined, name: string) =>
  element?.attributes.find((candidate) => candidate.namespace === "" && candidate.localName === name)?.value;

export const text = (element: XmlElement) => element.children.filter((child) => typeof child === "string").join("");
