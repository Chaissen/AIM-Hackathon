import { z } from "zod";

// Shared by Next.js, the Matrix bot and the scripts. Session authentication requires a private setup key.
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PUBLIC_URL: z.url().default("http://localhost:3010"),
  WORKSPACE_URL: z.url().default("http://localhost:8081"),
  ORDY_WEB_UPSTREAM: z.string().min(1).default("host.docker.internal:3010"),
  // The clinic that runs ordy, named in the portal and in every email and SMS.
  CLINIC_NAME: z.string().min(1).default("Klinikum Beispielstadt"),
  // Empty disables outside-person sessions until setup generates a private key.
  ORDY_SECRET: z.string().default(""),
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
  // Outgoing email: Gmail as ordysoftware@gmail.com. SMTP_PASSWORD is its app password and belongs only in .env.
  SMTP_HOST: z.string().default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().int().default(465),
  SMTP_USER: z.string().default("ordysoftware@gmail.com"),
  SMTP_PASSWORD: z.string().default(""),
  // Gmail replaces a sender address that is not the account's own.
  MAIL_FROM: z.string().default("ordy · Klinikum Beispielstadt <ordysoftware@gmail.com>"),
  // Every email goes to these addresses, whatever address the request names.
  MAIL_TEAM_INBOXES: z
    .string()
    .default("ordysoftware@gmail.com")
    .transform((list) => list.split(",").map((address) => address.trim()).filter(Boolean))
    .pipe(z.array(z.email()).min(1)),
  // eHVD web service (task T15): the mock from T23, or the real eHVD from an address BRZ has allowed.
  EHVD_URL: z.url().default("http://localhost:8095/"),
  // AI fallback parser (task T22). Unset ANTHROPIC_API_KEY turns it off.
  ANTHROPIC_API_KEY: z.preprocess((value) => (value === "" ? undefined : value), z.string().optional()),
  AI_FALLBACK_MODEL: z.string().default("claude-opus-5-5"),
});

export const env = schema.parse(process.env);

export const mxid = (localpart: string) => `@${localpart}:${env.MATRIX_SERVER_NAME}`;
