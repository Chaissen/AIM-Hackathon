import { z } from "zod";

import { documentTypeKeys } from "@/lib/document-types";

// What Dr. Hofer gives for one request in the widget. docs/ARCHITECTURE.md, "Widget".
export const requestInput = z
  .object({
    docType: z.enum(documentTypeKeys),
    // A FHIR Patient id (FHIR R4 "id" type) with at least one letter or digit, so "." or ".." cannot change the FHIR URL.
    patient: z
      .string()
      .trim()
      .regex(/^(?=.*[A-Za-z0-9])[A-Za-z0-9.-]{1,64}$/, "Choose a patient"),
    given: z.string().trim().min(1, "Enter the first name"),
    family: z.string().trim().min(1, "Enter the last name"),
    org: z.string().trim().min(1, "Enter the organisation"),
    email: z.email("Enter a valid email address").optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9][0-9 ]{5,}$/, "Enter a mobile number such as +43 660 000 0101")
      .optional(),
  })
  .refine((v) => v.email || v.phone, { message: "Enter an email address or a mobile number", path: ["email"] })
  .refine((v) => !(v.email && v.phone), { message: "Enter an email address or a mobile number, not both", path: ["email"] });

export type RequestInput = z.infer<typeof requestInput>;
