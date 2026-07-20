function createUserPublic(id, email, createdAt) {
  return { id, email, created_at: createdAt };
}

function createAuthResponse(token, user) {
  return { token, user };
}

function createDiscrepancyOut(discrepancy) {
  return discrepancy;
}

function createKpiSummary(summary) {
  return summary;
}

module.exports = {
  createUserPublic,
  createAuthResponse,
  createDiscrepancyOut,
  createKpiSummary,
};
