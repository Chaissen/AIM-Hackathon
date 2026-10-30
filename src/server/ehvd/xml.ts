import { SaxesParser } from "saxes";

// A small namespace-aware XML reader for the eHVD's SOAP responses. It keeps elements and their text, nothing else.

export type XmlElement = {
  /** Namespace URI, empty for no namespace. */
  uri: string;
  local: string;
  children: XmlElement[];
  /** The element's own text, without the text of its children. */
  text: string;
};

export class XmlError extends Error {}

/**
 * Parses one XML document. Throws an XmlError for XML that is not well-formed with namespaces, and for any DOCTYPE:
 * a SOAP message must not have one, and refusing it rules out entity tricks.
 */
export function parseXml(xml: string): XmlElement {
  const parser = new SaxesParser({ xmlns: true });
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;

  parser.on("error", (error) => {
    throw new XmlError(error.message);
  });
  parser.on("doctype", () => {
    throw new XmlError("A SOAP message must not have a DOCTYPE");
  });
  parser.on("opentag", (tag) => {
    const element: XmlElement = { uri: tag.uri ?? "", local: tag.local ?? tag.name, children: [], text: "" };
    const parent = stack.at(-1);
    if (parent) parent.children.push(element);
    else root = element;
    stack.push(element);
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  const addText = (text: string) => {
    const current = stack.at(-1);
    if (current) current.text += text;
  };
  parser.on("text", addText);
  parser.on("cdata", addText);

  parser.write(xml).close();
  if (!root) throw new XmlError("The document has no root element");
  return root;
}

/** The child elements with this namespace and local name. */
export const childrenNamed = (element: XmlElement, uri: string, local: string) =>
  element.children.filter((child) => child.uri === uri && child.local === local);

export const escapeXml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] ?? c);
