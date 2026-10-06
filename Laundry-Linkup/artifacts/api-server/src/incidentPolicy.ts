export const INCIDENT_FEE_CENTS = 399;
export const MAX_REIMBURSEMENT_CENTS = 5000;
export function isIncidentAdmin(userId: string): boolean {
  return (process.env.WASHMATE_ADMIN_USER_IDS ?? "").split(",").map(v => v.trim()).filter(Boolean).includes(userId);
}
export function canReadIncident(userId: string, incident: {customerId: string; washerId: string}, admin = isIncidentAdmin(userId)): boolean {
  return admin || incident.customerId === userId || incident.washerId === userId;
}
export function allocateFees(earnings: number, fees: {id: number; remaining: number}[]) {
  if (!Number.isSafeInteger(earnings) || earnings < 0) throw new Error("Invalid earnings");
  let available = earnings;
  const allocations: {feeId: number; amountCents: number}[] = [];
  for (const fee of fees) {
    if (!Number.isSafeInteger(fee.remaining) || fee.remaining < 0 || fee.remaining > INCIDENT_FEE_CENTS) throw new Error("Invalid fee ledger");
    const amountCents = Math.min(available, fee.remaining);
    if (amountCents) allocations.push({feeId: fee.id, amountCents});
    available -= amountCents;
  }
  return {allocations, amountCents: available, incidentFeeCents: earnings - available};
}
export function retryWindowOpen(at: Date | string | null): boolean {
  return !at || Date.now() - new Date(at).getTime() < 23 * 60 * 60 * 1000;
}