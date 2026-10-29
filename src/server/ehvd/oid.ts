import { z } from "zod";

const isArc = (arc: string) => arc !== "" && (arc === "0" || arc[0] !== "0") && [...arc].every((char) => char >= "0" && char <= "9");

// Dotted decimal without leading zeros, so an OID compares equal to the eHVD's spelling of it.
// ITU-T X.660 allows only 0, 1, and 2 as the first arc, and below 0 and 1 only 0 to 39 as the second.
export const oid = z.string().refine((value) => {
  const arcs = value.split(".");
  if (arcs.length < 2 || !arcs.every(isArc)) return false;
  const [first, second] = arcs;
  return first === "2" || ((first === "0" || first === "1") && Number(second) < 40);
}, "Must be an OID such as 1.2.40.0.34.3.2.99.1.2");
