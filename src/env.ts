import { z } from "zod";

// Shared by Next.js, the Matrix bot and the scripts. Every value has a demo default, so `.env` is optional.
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PUBLIC_URL: z.url().default("http://localhost:3010"),
  ORDY_SECRET: z.string().min(16).default("ordy-dev-secret-change-me"),
  DATABASE_URL: z.url().default("postgres://ordy:ordy@localhost:5433/ordy"),
  FHIR_BASE_URL: z.url().default("http://localhost:8090/fhir"),
  MATRIX_HOMESERVER_URL: z.url().default("http://localhost:8008"),
  MATRIX_SERVER_NAME: z.string().default("klinikum.example"),
  MATRIX_BOT_USER: z.string().default("ordy"),
  MATRIX_BOT_PASSWORD: z.string().default("ordy-demo-2026"),
  MATRIX_HOFER_USER: z.string().default("lena.hofer"),
  MATRIX_HOFER_PASSWORD: z.string().default("hofer-demo-2026"),
  MATRIX_ROOM_ALIAS: z.string().default("outside-documents"),
  // Simulated ID Austria (Keycloak, task T02). Real ID Austria only changes these three values.
  OIDC_METADATA_URL: z.url().default("http://localhost:8080/realms/idaustria-sim/.well-known/openid-configuration"),
  OIDC_CLIENT_ID: z.string().default("request-service"),
  // Older .env files carry an empty OIDC_CLIENT_SECRET=, which must fall back to the demo secret too.
  OIDC_CLIENT_SECRET: z.preprocess((value) => (value === "" ? undefined : value), z.string().default("request-service-demo-2026")),
  // Keycloak admin login for `pnpm citizen`, the values from docker-compose.yml. The app itself never needs them.
  KEYCLOAK_ADMIN_USER: z.string().default("admin"),
  KEYCLOAK_ADMIN_PASSWORD: z.string().default("keycloak-demo-2026"),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().default(1025),
  MAIL_FROM: z.string().default("ordy · Klinikum Beispielstadt <ordy@klinikum.example>"),
  MAILPIT_API_URL: z.url().default("http://localhost:8025"),
  ANTHROPIC_API_KEY: z.string().optional(),
});

export const env = schema.parse(process.env);

export const mxid = (localpart: string) => `@${localpart}:${env.MATRIX_SERVER_NAME}`;
