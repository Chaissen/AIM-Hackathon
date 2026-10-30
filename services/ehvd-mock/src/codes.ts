export const idKinds = {
  kaNr: "1.2.40.0.34.4.10",
  arztNr: "1.2.40.0.34.4.18",
  ambuNr: "1.2.40.0.34.4.20",
  vpnr: "1.2.40.0.10.1.4.3.2",
  gbrId: "1.2.40.0.34.4.23",
} as const;

export type IdKind = (typeof idKinds)[keyof typeof idKinds];

export const chamber = "Registrierungsstelle:Österreichische Ärztekammer";
export const stateGovernment = "Registrierungsstelle:Amt der Landesregierung";
