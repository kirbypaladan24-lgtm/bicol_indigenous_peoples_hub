export function parsePagination(req, defaults = {}) {
  const page = Math.max(1, Number(req.query.page || defaults.page || 1));
  const limit = Math.max(1, Math.min(100, Number(req.query.limit || defaults.limit || 20)));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}
